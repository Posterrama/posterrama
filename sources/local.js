const path = require('path');
const fs = require('fs-extra');
const chokidar = require('chokidar');
const { EventEmitter } = require('events');
const mimeTypes = require('mime-types');
const FileType = require('file-type');
const AdmZip = require('adm-zip');
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
        this.watchDirectories = Array.isArray(ld.watchDirectories) ? ld.watchDirectories : [];
        // Gate automatic ZIP importing (default: off)
        this.autoImportPosterpacks = ld.autoImportPosterpacks === true;
        // Consolidated list of absolute root directories to use
        this.rootPaths = [this.rootPath, ...this.watchDirectories]
            .filter(Boolean)
            .map(p => path.resolve(p));
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

        // Lightweight event hub for server integration (playlist refresh, UI updates)
        // Consumers can subscribe to: 'media-changed', 'posterpacks-changed', 'file-added',
        // 'file-removed', 'file-changed'
        this.events = new EventEmitter();

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

        // Directory structure (zip-only semantics: no separate posterpacks/clearlogos dirs)
        this.directories = {
            posters: 'posters',
            backgrounds: 'backgrounds',
            motion: 'motion',
            complete: 'complete',
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
            autoImportPosterpacks: this.autoImportPosterpacks,
        });
    }

    /**
     * Helper: test if a filepath is inside one of the "complete" export directories
     */
    isInCompleteExport(filePath) {
        try {
            const p = path.resolve(filePath);
            return this.rootPaths.some(base => {
                const completeDir = path.resolve(base, this.directories.complete);
                return (p + path.sep).startsWith(completeDir + path.sep) || p === completeDir;
            });
        } catch (_) {
            return false;
        }
    }

    /**
     * Helper: test if a filepath is specifically inside complete/manual (user-provided posterpacks)
     * Generated packs from Plex/Jellyfin must NOT be auto-imported to posters/backgrounds.
     */
    isInManualPosterpack(filePath) {
        try {
            const p = path.resolve(filePath);
            return this.rootPaths.some(base => {
                const manualDir = path.resolve(base, this.directories.complete, 'manual');
                return (p + path.sep).startsWith(manualDir + path.sep) || p === manualDir;
            });
        } catch (_) {
            return false;
        }
    }

    /**
     * Import all posterpack ZIPs from complete/*-export and manual folders into posters/backgrounds
     * Best-effort and idempotent: skips if destination files already exist.
     */
    async importPosterpacks(options = {}) {
        // ZIP-only semantics: do not extract. Optionally copy generated ZIPs into complete/manual.
        const { includeGenerated = false } = options;
        let copied = 0;
        for (const base of this.rootPaths) {
            const completeRoot = path.join(base, this.directories.complete);
            const manualDir = path.join(completeRoot, 'manual');
            try {
                await fs.ensureDir(manualDir);
            } catch (e) {
                logger.warn(`LocalDirectorySource: Failed to ensure manual dir: ${e?.message}`);
            }
            if (includeGenerated) {
                for (const sub of ['plex-export', 'jellyfin-export']) {
                    const dir = path.join(completeRoot, sub);
                    const exists = await fs.pathExists(dir);
                    if (!exists) continue;
                    let entries = [];
                    try {
                        entries = await fs.readdir(dir, { withFileTypes: true });
                    } catch (e) {
                        logger.debug(`LocalDirectorySource: Failed to read ${dir}: ${e?.message}`);
                    }
                    for (const ent of entries) {
                        if (!ent.isFile()) continue;
                        if (!/\.zip$/i.test(ent.name)) continue;
                        const src = path.join(dir, ent.name);
                        const dst = path.join(manualDir, ent.name);
                        try {
                            const existsDst = await fs.pathExists(dst);
                            if (!existsDst) {
                                await fs.copy(src, dst);
                                copied++;
                            }
                        } catch (e) {
                            logger.warn(
                                `LocalDirectorySource: Failed to copy ${src} → ${dst}: ${e?.message}`
                            );
                        }
                    }
                }
            }
        }
        if (copied > 0) {
            this.metrics.posterpacks += copied;
            logger.info(
                `LocalDirectorySource: Copied ${copied} posterpack ZIP(s) into complete/manual`
            );
        }
        return copied;
    }

    /**
     * Process a single posterpack ZIP and extract poster/background and metadata
     * Returns true if at least one asset was imported, false otherwise
     */
    // Deprecated: no longer extracts posterpack ZIPs; kept for backward compatibility
    async processPosterpackZip(_zipFilePath, _options = {}) {
        return false;
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

            // Scan directory for native files (images/videos)
            const files = await this.scanDirectory(targetDirectory);

            // Augment with ZIP-based poster/background assets from complete/manual without extraction
            // We only consider manual posterpacks to avoid mass duplicates from generated exports.
            if (type === 'poster' || type === 'background') {
                try {
                    const zipFiles = await this.scanZipPosterpacks(type);
                    files.push(...zipFiles);
                } catch (e) {
                    logger.warn(
                        `LocalDirectorySource: Failed to scan ZIP posterpacks for ${type}: ${e?.message}`
                    );
                }
            }

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
        const allFiles = [];
        for (const base of this.rootPaths) {
            const targetPath = path.join(base, directoryName);
            if (!(await fs.pathExists(targetPath))) {
                logger.debug(`LocalDirectorySource: Directory does not exist: ${targetPath}`);
                continue;
            }
            try {
                const files = await fs.readdir(targetPath, { withFileTypes: true });
                for (const file of files) {
                    if (file.isFile()) {
                        const filePath = path.join(targetPath, file.name);
                        const ext = path.extname(file.name).toLowerCase().slice(1);
                        if (this.supportedFormats.includes(ext)) {
                            const stats = await fs.stat(filePath);
                            if (stats.size <= this.maxFileSize) {
                                allFiles.push({
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
            } catch (error) {
                logger.error(
                    `LocalDirectorySource: Error scanning directory ${targetPath}:`,
                    error
                );
            }
        }
        logger.debug(
            `LocalDirectorySource: Found ${allFiles.length} valid files in ${directoryName} across ${this.rootPaths.length} roots`
        );
        return allFiles;
    }

    /**
     * Scan complete/manual for posterpack ZIPs that contain the requested entry type
     * Returns synthetic file records representing poster/background items backed by ZIP entries
     * @param {('poster'|'background')} type
     * @returns {Promise<Array<{name:string,path:string,size:number,modified:Date,extension:string,directory:string,type:string}>>}
     */
    async scanZipPosterpacks(type) {
        const results = [];
        const want = type === 'background' ? 'background' : 'poster';
        const exts = ['jpg', 'jpeg', 'png', 'webp'];
        // Priority order: manual > plex-export > jellyfin-export
        const subdirs = ['manual', 'plex-export', 'jellyfin-export'];
        const seen = new Set(); // de-dup by basename (without .zip)
        for (const base of this.rootPaths) {
            const completeRoot = path.join(base, this.directories.complete);
            for (const sub of subdirs) {
                const dir = path.join(completeRoot, sub);
                const exists = await fs.pathExists(dir);
                if (!exists) continue;
                let entries = [];
                try {
                    entries = await fs.readdir(dir, { withFileTypes: true });
                } catch (e) {
                    logger.debug(
                        `LocalDirectorySource: Failed to read posterpacks at ${dir}: ${e?.message}`
                    );
                }
                for (const ent of entries) {
                    if (!ent.isFile()) continue;
                    if (!/\.zip$/i.test(ent.name)) continue;
                    const baseName = ent.name.replace(/\.zip$/i, '');
                    if (seen.has(baseName)) continue; // keep higher-priority one
                    const zipFull = path.join(dir, ent.name);
                    try {
                        const zip = new AdmZip(zipFull);
                        const zipEntries = zip.getEntries();
                        let found = false;
                        const has = {
                            poster: false,
                            background: false,
                            thumbnail: false,
                            clearlogo: false,
                        };
                        for (const ext of exts) {
                            const rePoster = new RegExp(`(^|/)poster\.${ext}$`, 'i');
                            const reBg = new RegExp(`(^|/)background\.${ext}$`, 'i');
                            const reThumb = new RegExp(`(^|/)(thumb|thumbnail)\.${ext}$`, 'i');
                            const reClearLogo = new RegExp(`(^|/)clearlogo\.${ext}$`, 'i');
                            if (zipEntries.some(e => rePoster.test(e.entryName))) has.poster = true;
                            if (zipEntries.some(e => reBg.test(e.entryName))) has.background = true;
                            if (zipEntries.some(e => reThumb.test(e.entryName)))
                                has.thumbnail = true;
                            if (zipEntries.some(e => reClearLogo.test(e.entryName)))
                                has.clearlogo = true;
                        }
                        found = has[want];
                        if (!found) continue;
                        const st = await fs.stat(zipFull);
                        results.push({
                            name: ent.name,
                            path: zipFull,
                            size: st.size,
                            modified: st.mtime,
                            extension: 'zip',
                            directory: want === 'background' ? 'backgrounds' : 'posters',
                            type: want,
                            zipHas: has,
                        });
                        seen.add(baseName);
                    } catch (e) {
                        logger.debug(
                            `LocalDirectorySource: Failed to inspect ZIP ${zipFull}: ${e?.message}`
                        );
                    }
                }
            }
        }
        if (results.length) {
            logger.debug(
                `LocalDirectorySource: Found ${results.length} ${want} items inside ZIP posterpacks (manual/plex/jellyfin)`
            );
        }
        return results;
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

            // Determine target path: interpret incoming path as anchored to base
            // Accept three forms:
            // 1) empty or '/' → base
            // 2) absolute that starts with base → use as-is
            // 3) absolute that doesn't start with base → treat as relative to base (strip leading '/')
            // 4) relative → join with base
            let targetPath;
            if (!reqRaw || reqRaw === '/' || reqRaw === '.') {
                targetPath = base;
            } else if (path.isAbsolute(reqRaw)) {
                const abs = path.resolve(reqRaw);
                if (abs === base || (abs + path.sep).startsWith(base + path.sep)) {
                    targetPath = abs;
                } else {
                    // Treat absolute-from-root UI paths like '/backgrounds' as relative to base
                    targetPath = path.resolve(base, reqRaw.replace(/^\/+/, ''));
                }
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

            // helper: compute recursive directory size with simple cycle guard
            const dirSize = async dir => {
                let total = 0;
                const stack = [dir];
                const visited = new Set();
                while (stack.length) {
                    const cur = stack.pop();
                    if (visited.has(cur)) continue;
                    visited.add(cur);
                    let entries;
                    try {
                        entries = await fs.readdir(cur, { withFileTypes: true });
                    } catch (_) {
                        continue;
                    }
                    for (const ent of entries) {
                        if (
                            ent.name === this.directories.system ||
                            ent.name.endsWith('.poster.json')
                        )
                            continue;
                        const full = path.join(cur, ent.name);
                        try {
                            const st = await fs.stat(full);
                            if (st.isDirectory()) stack.push(full);
                            else if (st.isFile()) total += st.size;
                        } catch (e) {
                            logger.debug(
                                `LocalDirectorySource: Failed to stat during size calc for ${full}: ${e?.message}`
                            );
                        }
                    }
                }
                return total;
            };

            // helper: recursively count files (not directories) under a folder
            const dirFileCount = async dir => {
                let total = 0;
                const stack = [dir];
                const visited = new Set();
                while (stack.length) {
                    const cur = stack.pop();
                    if (visited.has(cur)) continue;
                    visited.add(cur);
                    let entries;
                    try {
                        entries = await fs.readdir(cur, { withFileTypes: true });
                    } catch (_) {
                        continue;
                    }
                    for (const ent of entries) {
                        if (
                            ent.name === this.directories.system ||
                            ent.name.endsWith('.poster.json')
                        )
                            continue;
                        const full = path.join(cur, ent.name);
                        try {
                            const st = await fs.stat(full);
                            if (st.isDirectory()) {
                                stack.push(full);
                            } else if (st.isFile()) {
                                total += 1;
                            }
                        } catch (e) {
                            logger.debug(
                                `LocalDirectorySource: Failed to stat during count for ${full}: ${e?.message}`
                            );
                        }
                    }
                }
                return total;
            };

            const directories = [];
            const files = [];

            for (const item of items) {
                try {
                    if (item.isDirectory()) {
                        // Hide internal system directory from listings
                        if (item.name === this.directories.system) {
                            continue;
                        }
                        if (type === 'all' || type === 'directories') {
                            // compute size recursively and count files recursively (folders not counted)
                            let sizeBytes = 0;
                            let itemCount = 0;
                            try {
                                sizeBytes = await dirSize(path.join(targetPath, item.name));
                                itemCount = await dirFileCount(path.join(targetPath, item.name));
                            } catch (e) {
                                logger.debug(
                                    `LocalDirectorySource: Failed to compute dir size for ${path.join(
                                        targetPath,
                                        item.name
                                    )}: ${e?.message}`
                                );
                            }
                            directories.push({ name: item.name, sizeBytes, itemCount });
                        }
                    } else if (item.isSymbolicLink()) {
                        // Include symlinked directories
                        const linkPath = path.join(targetPath, item.name);
                        const s = await fs.stat(linkPath).catch(() => null);
                        if (
                            s?.isDirectory() &&
                            item.name !== this.directories.system &&
                            (type === 'all' || type === 'directories')
                        ) {
                            let sizeBytes = 0;
                            let itemCount = 0;
                            try {
                                sizeBytes = await dirSize(linkPath);
                                itemCount = await dirFileCount(linkPath);
                            } catch (e) {
                                logger.debug(
                                    `LocalDirectorySource: Failed to compute symlinked dir size for ${linkPath}: ${e?.message}`
                                );
                            }
                            directories.push({ name: item.name, sizeBytes, itemCount });
                        }
                    } else if (item.isFile()) {
                        // Hide generated metadata files from listings
                        if (item.name.endsWith('.poster.json')) {
                            continue;
                        }
                        if (type === 'all' || type === 'files') {
                            let sizeBytes = 0;
                            let zipPills = null;
                            try {
                                const st = await fs.stat(path.join(targetPath, item.name));
                                if (st?.isFile()) sizeBytes = st.size;
                                // If this is a ZIP inside complete/*, summarize its contents
                                if (/\.zip$/i.test(item.name)) {
                                    const fullZip = path.join(targetPath, item.name);
                                    if (this.isInCompleteExport(fullZip)) {
                                        try {
                                            const zip = new AdmZip(fullZip);
                                            const entries = zip
                                                .getEntries()
                                                .filter(e => !e.isDirectory);
                                            const has = pattern =>
                                                entries.some(e => pattern.test(e.entryName));
                                            zipPills = [];
                                            if (has(/(^|\/)poster\.(jpg|jpeg|png|webp)$/i))
                                                zipPills.push('poster');
                                            if (
                                                has(
                                                    /(^|\/)(background|backdrop)\.(jpg|jpeg|png|webp)$/i
                                                )
                                            )
                                                zipPills.push('background');
                                            if (has(/(^|\/)clearlogo\.(png|webp)$/i))
                                                zipPills.push('clearlogo');
                                            if (has(/(^|\/)metadata\.json$/i))
                                                zipPills.push('metadata');
                                            if (has(/(^|\/)cd\.(jpg|jpeg|png|webp|svg)$/i))
                                                zipPills.push('cd');
                                            if (has(/(^|\/)disc\.(jpg|jpeg|png|webp|svg)$/i))
                                                zipPills.push('disc');
                                        } catch (e) {
                                            logger.debug(
                                                `LocalDirectorySource: ZIP summary failed for ${fullZip}: ${e?.message}`
                                            );
                                        }
                                    }
                                }
                            } catch (e) {
                                logger.debug(
                                    `LocalDirectorySource: Failed to stat file for size ${path.join(
                                        targetPath,
                                        item.name
                                    )}: ${e?.message}`
                                );
                            }
                            const fileEntry = { name: item.name, sizeBytes };
                            if (zipPills && zipPills.length) fileEntry.zipPills = zipPills;
                            files.push(fileEntry);
                        }
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
                directories: directories.sort((a, b) => a.name.localeCompare(b.name)),
                files: files.sort((a, b) => a.name.localeCompare(b.name)),
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

        // Fast-path: return cached metadata if available to avoid duplicate IO/logging
        try {
            if (this.indexCache.has(metadataPath)) {
                return this.indexCache.get(metadataPath);
            }
        } catch (_) {
            // Intentionally ignore cache lookup errors (cache may be in transient state)
        }

        // Try to load existing metadata
        if (await fs.pathExists(metadataPath)) {
            try {
                const metadata = await fs.readJson(metadataPath);
                // Cache for subsequent accesses during this cycle
                try {
                    this.indexCache.set(metadataPath, metadata);
                } catch (_) {
                    // Non-fatal: cache insertion failed, continue without cache
                }
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
            try {
                // Keep metadata in cache for this session to prevent duplicate reload/log lines
                this.indexCache.set(metadataPath, metadata);
            } catch (_) {
                // Non-fatal: if caching fails we still proceed
            }
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
        // Build URL relative to the first matching root
        let relativePath = file.path;
        for (const base of this.rootPaths) {
            const rel = path.relative(base, file.path);
            if (!rel.startsWith('..')) {
                relativePath = rel;
                break;
            }
        }
        const relUrlPath = relativePath.replace(/\\/g, '/');
        const isZip = (file.extension || '').toLowerCase() === 'zip';
        // If this media is backed by a ZIP posterpack, stream the inner entry on demand
        let mediaUrl = `/local-media/${relUrlPath}`;
        let clearlogoPath = null;
        let backgroundUrl = metadata.backgroundPath || null;
        let thumbnailUrl = metadata.thumbnailPath || null;
        if (isZip) {
            const entry = file.type === 'background' ? 'background' : 'poster';
            const encoded = encodeURIComponent(relUrlPath);
            mediaUrl = `/local-posterpack?zip=${encoded}&entry=${entry}`;
            // Provide clearlogo path if available; client normalizer may pick this up
            clearlogoPath = `/local-posterpack?zip=${encoded}&entry=clearlogo`;
            // If ZIP contains background/thumbnail, expose streaming URLs
            try {
                if (file.zipHas && file.zipHas.background) {
                    backgroundUrl = `/local-posterpack?zip=${encoded}&entry=background`;
                }
                if (file.zipHas && file.zipHas.thumbnail) {
                    thumbnailUrl = `/local-posterpack?zip=${encoded}&entry=thumbnail`;
                }
            } catch (_) {
                /* ignore */
            }
        }

        return {
            title: metadata.title,
            year: metadata.year,
            poster: mediaUrl,
            background: backgroundUrl,
            clearart: metadata.clearartPath || null,
            clearlogoPath: clearlogoPath || metadata.clearlogoPath || null,
            // Compat with UI schema
            backgroundUrl: backgroundUrl,
            clearLogoUrl: clearlogoPath || metadata.clearlogoPath || null,
            thumbnailUrl: thumbnailUrl,
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
                this.directories.system,
                path.join(this.directories.system, 'logs'),
            ];

            for (const base of this.rootPaths) {
                for (const dir of dirsToCreate) {
                    const fullPath = path.join(base, dir);
                    await fs.ensureDir(fullPath);
                    logger.debug(`LocalDirectorySource: Created directory ${fullPath}`);
                }
            }

            // Create system config file
            for (const base of this.rootPaths) {
                const systemConfigPath = path.join(base, this.directories.system, 'config.json');
                if (!(await fs.pathExists(systemConfigPath))) {
                    const systemConfig = {
                        version: '1.0.0',
                        created: new Date().toISOString(),
                        directories: this.directories,
                    };
                    await fs.writeJson(systemConfigPath, systemConfig, { spaces: 2 });
                }
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
            const watchRoots = this.rootPaths.map(p => path.resolve(p));
            this.watcher = chokidar.watch(watchRoots, {
                ignored: watchRoots
                    .map(watchRoot => [path.join(watchRoot, this.directories.system, '**')])
                    .flat()
                    .concat(/\.poster\.json$/), // Ignore metadata files
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
                // Notify listeners so the server can refresh playlist/UI promptly
                try {
                    this.events.emit('file-added', { path: filePath });
                    this.events.emit('media-changed', { path: filePath, kind: 'add' });
                    // Special signal when a ZIP appears under complete/* (manual or exports)
                    const isZip = /\.zip$/i.test(filePath);
                    if (
                        isZip &&
                        (this.isInCompleteExport(filePath) || this.isInManualPosterpack(filePath))
                    ) {
                        this.events.emit('posterpacks-changed', { path: filePath, kind: 'add' });
                    }
                } catch (e) {
                    // Emitting events should never crash the watcher; ignore but log for diagnostics
                    logger.debug(
                        'LocalDirectorySource: emit on file-added failed (ignored):',
                        e?.message || e
                    );
                }

                // ZIP posterpacks under complete/* are never extracted automatically; they are streamed on demand.
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
            // Notify listeners so the server can refresh playlist/UI promptly
            try {
                this.events.emit('file-removed', { path: filePath });
                this.events.emit('media-changed', { path: filePath, kind: 'remove' });
                const wasZip = /\.zip$/i.test(filePath);
                if (
                    wasZip &&
                    (this.isInCompleteExport(filePath) || this.isInManualPosterpack(filePath))
                ) {
                    this.events.emit('posterpacks-changed', { path: filePath, kind: 'remove' });
                }
            } catch (e) {
                // Emitting events should never crash the watcher; ignore but log for diagnostics
                logger.debug(
                    'LocalDirectorySource: emit on file-removed failed (ignored):',
                    e?.message || e
                );
            }
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
            // Notify listeners so the server can refresh playlist/UI promptly
            try {
                this.events.emit('file-changed', { path: filePath });
                this.events.emit('media-changed', { path: filePath, kind: 'change' });
                const isZip = /\.zip$/i.test(filePath);
                if (
                    isZip &&
                    (this.isInCompleteExport(filePath) || this.isInManualPosterpack(filePath))
                ) {
                    this.events.emit('posterpacks-changed', { path: filePath, kind: 'change' });
                }
            } catch (e) {
                // Emitting events should never crash the watcher; ignore but log for diagnostics
                logger.debug(
                    'LocalDirectorySource: emit on file-changed failed (ignored):',
                    e?.message || e
                );
            }
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

            // Import any existing posterpacks (manual only by default) so the screensaver can use them automatically
            if (this.autoImportPosterpacks === true) {
                try {
                    // By default, only import from complete/manual to avoid mass-importing generated exports
                    await this.importPosterpacks({ includeGenerated: false });
                } catch (e) {
                    logger.warn(
                        `LocalDirectorySource: Initial posterpack import encountered issues: ${e?.message}`
                    );
                }
            } else {
                logger.info(
                    'LocalDirectorySource: Auto-import of posterpacks is disabled (ZIPs will remain only under complete/*).'
                );
            }

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

                if ((type === 'delete-contents' || type === 'delete') && targetPath) {
                    try {
                        // Security check
                        const resolvedPath = path.resolve(targetPath);
                        if (resolvedPath.includes('..')) {
                            throw new Error('Path traversal not allowed');
                        }

                        if (type === 'delete-contents') {
                            // Only delete the contents within the target directory, not the directory itself
                            const stat = await fs.stat(resolvedPath).catch(() => null);
                            if (!stat || !stat.isDirectory()) {
                                throw new Error('Target is not a directory');
                            }
                            let deletedCount = 0;
                            if (!dryRun) {
                                const entries = await fs.readdir(resolvedPath, {
                                    withFileTypes: true,
                                });
                                for (const entry of entries) {
                                    const childPath = path.join(resolvedPath, entry.name);
                                    await fs.remove(childPath);
                                    deletedCount++;
                                }
                            } else {
                                // Dry run: count entries without deleting
                                const entries = await fs.readdir(resolvedPath);
                                deletedCount = entries.length;
                            }
                            results.operations.push({
                                type: 'delete-contents',
                                path: targetPath,
                                deletedCount,
                                status: dryRun ? 'would_delete_contents' : 'contents_deleted',
                            });
                        } else {
                            // Full delete of file or directory
                            if (!dryRun) {
                                await fs.remove(resolvedPath);
                            }
                            results.operations.push({
                                type: 'delete',
                                path: targetPath,
                                status: dryRun ? 'would_delete' : 'deleted',
                            });
                        }

                        // If caller deleted or cleared the 'complete' root, ensure its subdirectories exist again
                        // We do this after either delete-contents or delete operations (only when not a dryRun)
                        if (!dryRun) {
                            for (const base of this.rootPaths) {
                                const completeRoot = path.join(base, this.directories.complete);
                                if (
                                    resolvedPath === completeRoot ||
                                    // handle delete-contents on complete root
                                    (type === 'delete-contents' && resolvedPath === completeRoot)
                                ) {
                                    try {
                                        // Recreate the known subdirectories under complete
                                        await fs.ensureDir(path.join(completeRoot, 'plex-export'));
                                        await fs.ensureDir(
                                            path.join(completeRoot, 'jellyfin-export')
                                        );
                                        await fs.ensureDir(path.join(completeRoot, 'manual'));
                                        logger.info(
                                            'LocalDirectorySource: Recreated complete/* subdirectories after cleanup operation'
                                        );
                                    } catch (e) {
                                        logger.warn(
                                            `LocalDirectorySource: Failed to recreate complete subdirectories: ${e?.message}`
                                        );
                                    }
                                }
                            }
                        }
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

            // Get stats for each configured directory across all roots
            for (const base of this.rootPaths) {
                for (const dirName of Object.values(this.directories)) {
                    const dirPath = path.join(base, dirName);
                    if (fs.existsSync(dirPath)) {
                        const dirStats = await this.getDirectoryStatsRecursive(dirPath);
                        stats.totalDirectories += dirStats.directories;
                        stats.totalFiles += dirStats.files;
                        stats.totalSize += dirStats.size;
                        stats.supportedFiles += dirStats.supportedFiles;
                    }
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

    /**
     * Rescan local media directories and optionally generate missing metadata
     * @param {Object} options
     * @param {boolean} [options.createMetadata=true] - Whether to create missing *.poster.json files
     * @returns {Object} Summary of the rescan
     */
    async rescan(options = {}) {
        const { createMetadata = true } = options;

        const summary = {
            success: true,
            totalFilesScanned: 0,
            metadataCreated: 0,
            errors: [],
        };

        try {
            // Ensure directory structure exists before scanning
            await this.createDirectoryStructure();

            const targetDirs = [
                this.directories.posters,
                this.directories.backgrounds,
                this.directories.motion,
            ];

            for (const dirName of targetDirs) {
                try {
                    const files = await this.scanDirectory(dirName);
                    for (const f of files) {
                        summary.totalFilesScanned++;
                        if (!createMetadata) continue;
                        try {
                            const mdPath = this.getMetadataPath(f.path);
                            const exists = await fs.pathExists(mdPath);
                            if (!exists) {
                                const meta = this.parseFilename(f.name, f);
                                await this.saveMetadata(mdPath, meta);
                                summary.metadataCreated++;
                            }
                        } catch (err) {
                            summary.errors.push({ file: f.path, error: err.message });
                        }
                    }
                } catch (e) {
                    summary.errors.push({ directory: dirName, error: e.message });
                }
            }

            this.updateMetrics();
            if (summary.errors.length > 0) summary.success = false;
            return summary;
        } catch (error) {
            await this.handleError('rescan', error);
            return {
                success: false,
                totalFilesScanned: 0,
                metadataCreated: 0,
                errors: [{ error: error.message }],
            };
        }
    }
}

module.exports = LocalDirectorySource;
