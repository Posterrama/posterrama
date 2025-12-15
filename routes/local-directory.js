/**
 * Local Directory Management Routes
 * Handles local media scanning, browsing, uploads, job queue management, and posterpack generation
 */

module.exports = function createLocalDirectoryRouter({
    logger,
    config,
    express,
    asyncHandler,
    isAuthenticated,
    localDirectorySource,
    jobQueue,
    uploadMiddleware,
    cacheManager,
    refreshPlaylistCache,
    fs,
    path,
    getPlexClient,
    getJellyfinClient,
}) {
    const router = express.Router();

    const archiver = require('archiver');

    const parsePositiveInt = (value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
        const n = Number.parseInt(String(value ?? ''), 10);
        if (!Number.isFinite(n)) return fallback;
        if (n < min) return min;
        if (n > max) return max;
        return n;
    };

    const getZipLimits = () => {
        return {
            maxFiles: parsePositiveInt(process.env.LOCAL_ZIP_MAX_FILES, 5000, {
                min: 1,
                max: 200000,
            }),
            maxBytes: parsePositiveInt(process.env.LOCAL_ZIP_MAX_BYTES, 1024 * 1024 * 1024, {
                min: 1,
                max: Number.MAX_SAFE_INTEGER,
            }),
            maxDepth: parsePositiveInt(process.env.LOCAL_ZIP_MAX_DEPTH, 25, { min: 1, max: 200 }),
            maxSingleFileBytes: parsePositiveInt(
                process.env.LOCAL_ZIP_MAX_SINGLE_FILE_BYTES,
                512 * 1024 * 1024,
                { min: 1, max: Number.MAX_SAFE_INTEGER }
            ),
        };
    };

    const zipJoin = (...parts) => parts.filter(Boolean).join('/').replace(/\\/g, '/');

    const isSkippableLocalEntry = dirent => {
        if (!dirent || !dirent.name) return false;
        if (dirent.name === '.posterrama') return true;
        if (dirent.isFile?.() && dirent.name.endsWith('.poster.json')) return true;
        return false;
    };

    const createDirectoryFileWalker = (rootDir, { maxDepth }) => {
        const root = path.resolve(rootDir);

        async function* walk(currentDir, depth, relDir) {
            if (depth > maxDepth) return;

            let handle;
            try {
                handle = await fs.promises.opendir(currentDir);
            } catch (_) {
                return;
            }

            for await (const dirent of handle) {
                if (isSkippableLocalEntry(dirent)) continue;
                if (dirent.isSymbolicLink?.()) continue;

                const absPath = path.join(currentDir, dirent.name);
                const relPath = relDir ? zipJoin(relDir, dirent.name) : dirent.name;

                if (dirent.isDirectory?.()) {
                    yield* walk(absPath, depth + 1, relPath);
                } else if (dirent.isFile?.()) {
                    const st = await fs.promises.stat(absPath).catch(() => null);
                    if (!st || !st.isFile()) continue;
                    yield { absPath, relPath, size: st.size };
                }
            }
        }

        return () => walk(root, 0, '');
    };

    const preflightZipLimits = async (createIterator, limits) => {
        let files = 0;
        let totalBytes = 0;
        for await (const file of createIterator()) {
            files += 1;
            totalBytes += Number(file.size) || 0;

            if (file.size > limits.maxSingleFileBytes) {
                const err = new Error('zip_limits_exceeded');
                err.code = 'zip_limits_exceeded';
                err.reason = 'max_single_file_bytes';
                err.file = file.relPath;
                err.limit = limits.maxSingleFileBytes;
                throw err;
            }
            if (files > limits.maxFiles) {
                const err = new Error('zip_limits_exceeded');
                err.code = 'zip_limits_exceeded';
                err.reason = 'max_files';
                err.limit = limits.maxFiles;
                throw err;
            }
            if (totalBytes > limits.maxBytes) {
                const err = new Error('zip_limits_exceeded');
                err.code = 'zip_limits_exceeded';
                err.reason = 'max_bytes';
                err.limit = limits.maxBytes;
                throw err;
            }
        }
        return { files, totalBytes };
    };

    /**
     * @swagger
     * /api/local/scan:
     *   post:
     *     summary: Scan local media directories
     *     description: Rescan posters/backgrounds/motion folders and generate missing metadata files
     *     tags: ['Local Directory']
     *     requestBody:
     *       required: false
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               createMetadata:
     *                 type: boolean
     *                 description: Create missing *.poster.json metadata files
     *                 default: true
     *     responses:
     *       200:
     *         description: Scan completed
     *       404:
     *         description: Local directory not enabled
     */
    router.post(
        '/api/local/scan',
        express.json(),
        asyncHandler(async (req, res) => {
            if (!config.localDirectory?.enabled || !localDirectorySource) {
                return res.status(404).json({ error: 'Local directory support not enabled' });
            }
            try {
                const { createMetadata = true } = req.body || {};
                const summary = await localDirectorySource.rescan({ createMetadata });
                return res.json({ success: summary.success, ...summary });
            } catch (e) {
                logger.error('Local rescan failed:', e);
                return res.status(500).json({ error: e.message || 'scan_failed' });
            }
        })
    );

    /**
     * @swagger
     * /api/local/browse:
     *   get:
     *     summary: Browse local directory structure
     *     description: Get directory contents and file information for local media management
     *     tags: ['Local Directory']
     *     parameters:
     *       - in: query
     *         name: path
     *         schema:
     *           type: string
     *         description: Relative path to browse (defaults to root)
     *       - in: query
     *         name: type
     *         schema:
     *           type: string
     *           enum: [all, directories, files, media]
     *         description: Filter results by type
     *     responses:
     *       200:
     *         description: Directory contents
     *       404:
     *         description: Directory not found
     *       500:
     *         description: Server error
     */
    router.get(
        '/api/local/browse',
        asyncHandler(async (req, res) => {
            // Permit browsing even if Local source is disabled for playlist purposes.
            if (!localDirectorySource) {
                try {
                    const LocalDirectorySource = require('../sources/local');
                    // @ts-ignore - LocalDirectorySource constructor accepts 2 arguments
                    localDirectorySource = new LocalDirectorySource(config.localDirectory, logger);
                } catch (e) {
                    return res.status(500).json({ error: 'Local directory unavailable' });
                }
            }

            const { path: relativePath = '', type = 'all' } = req.query;

            try {
                // Prevent intermediaries from caching directory listings; sizes should reflect realtime state
                res.setHeader('Cache-Control', 'no-store');
                const contents = await localDirectorySource.browseDirectory(relativePath, type);
                res.json(contents);
            } catch (error) {
                logger.error('Local directory browse error:', error);
                if (error.code === 'ENOENT') {
                    res.status(404).json({ error: 'Directory not found' });
                } else {
                    res.status(500).json({ error: error.message });
                }
            }
        })
    );

    /**
     * @swagger
     * /api/local/search:
     *   get:
     *     summary: Recursively search for files and folders in local directory
     *     description: Searches recursively through all subdirectories for matching files and folders
     *     tags: ['Local Directory']
     *     parameters:
     *       - in: query
     *         name: query
     *         required: true
     *         schema:
     *           type: string
     *         description: Search query string
     *       - in: query
     *         name: path
     *         schema:
     *           type: string
     *         description: Starting path for search (defaults to root)
     *     responses:
     *       200:
     *         description: Array of matching items
     *       500:
     *         description: Server error
     */
    router.get(
        '/api/local/search',
        asyncHandler(async (req, res) => {
            if (!localDirectorySource) {
                try {
                    const LocalDirectorySource = require('../sources/local');
                    // @ts-ignore - LocalDirectorySource constructor accepts 2 arguments
                    localDirectorySource = new LocalDirectorySource(config.localDirectory, logger);
                } catch (e) {
                    return res.status(500).json({ error: 'Local directory unavailable' });
                }
            }

            const { query = '', path: startPath = '' } = req.query;
            const searchQuery = String(query).toLowerCase().trim();

            if (!searchQuery) {
                return res.json([]);
            }

            try {
                res.setHeader('Cache-Control', 'no-store');

                const base = path.resolve(config.localDirectory.rootPath);
                const searchRoot = startPath ? path.resolve(base, startPath) : base;

                // Verify search root is within base
                const within =
                    searchRoot === base || (searchRoot + path.sep).startsWith(base + path.sep);
                if (!within) {
                    return res.status(400).json({ error: 'Invalid path' });
                }

                const results = [];
                const maxResults = 100; // Limit results to prevent overwhelming the UI

                async function searchRecursive(dir, relativePath = '') {
                    if (results.length >= maxResults) return;

                    try {
                        const entries = await fs.promises.readdir(dir, { withFileTypes: true });

                        for (const entry of entries) {
                            if (results.length >= maxResults) break;

                            const entryPath = path.join(dir, entry.name);
                            const entryRelativePath = relativePath
                                ? `${relativePath}/${entry.name}`
                                : entry.name;

                            // Skip .poster.json files
                            if (entry.name.endsWith('.poster.json')) {
                                continue;
                            }

                            // Check if name matches query
                            if (entry.name.toLowerCase().includes(searchQuery)) {
                                const stats = await fs.promises.stat(entryPath).catch(() => null);
                                const resultPath = startPath
                                    ? `${startPath}/${entryRelativePath}`
                                    : entryRelativePath;
                                results.push({
                                    name: entry.name,
                                    path: resultPath,
                                    type: entry.isDirectory() ? 'directory' : 'file',
                                    sizeBytes: stats && stats.isFile() ? stats.size : null,
                                });
                            }

                            // Recurse into directories
                            if (entry.isDirectory()) {
                                await searchRecursive(entryPath, entryRelativePath);
                            }
                        }
                    } catch (error) {
                        // Skip directories we can't read
                        logger.debug(`Search skipped directory: ${dir}`, error.message);
                    }
                }

                await searchRecursive(searchRoot);
                res.json(results);
            } catch (error) {
                logger.error('Local directory search error:', error);
                res.status(500).json({ error: error.message });
            }
        })
    );

    /**
     * @swagger
     * /api/local/download:
     *   get:
     *     summary: Download a single file from the local directory
     *     description: Streams a single file to the client after validating the path is within the configured root
     *     tags: ['Local Directory']
     *     parameters:
     *       - in: query
     *         name: path
     *         required: true
     *         schema:
     *           type: string
     *         description: Absolute or relative path to the file under the local root
     *     responses:
     *       200:
     *         description: File stream
     *       400:
     *         description: Invalid request or path
     *       404:
     *         description: File not found
     */
    router.get(
        '/api/local/download',
        isAuthenticated,
        asyncHandler(async (req, res) => {
            const requestedPath = String(req.query.path || '').trim();
            if (!requestedPath) {
                return res.status(400).json({ error: 'Missing path' });
            }

            try {
                const base = path.resolve(config.localDirectory.rootPath);
                let fullPath;
                if (path.isAbsolute(requestedPath)) {
                    const abs = path.resolve(requestedPath);
                    fullPath = abs.startsWith(base)
                        ? abs
                        : path.resolve(base, requestedPath.replace(/^\/+/, ''));
                } else {
                    fullPath = path.resolve(base, requestedPath);
                }
                // ensure within base
                const within =
                    fullPath === base || (fullPath + path.sep).startsWith(base + path.sep);
                if (!within) return res.status(400).json({ error: 'Invalid path' });

                const st = await fs.promises.stat(fullPath).catch(() => null);
                if (!st || !st.isFile()) return res.status(404).json({ error: 'File not found' });

                const mime = require('mime-types');
                const type = mime.lookup(fullPath) || 'application/octet-stream';
                res.setHeader('Content-Type', type);
                // Set content-disposition using filename only
                const filename = path.basename(fullPath);
                res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
                return res.sendFile(fullPath);
            } catch (error) {
                logger.error('Local file download error:', error);
                return res.status(500).json({ error: 'download_failed' });
            }
        })
    );

    /**
     * @swagger
     * /api/local/download-all:
     *   get:
     *     summary: Download a directory as a ZIP (recursive)
     *     description: Zips a directory under the local root and streams it to the client
     *     tags: ['Local Directory']
     *     parameters:
     *       - in: query
     *         name: path
     *         required: true
     *         schema:
     *           type: string
     *         description: Absolute or relative path to the directory under the local root
     *     responses:
     *       200:
     *         description: ZIP stream
     *       400:
     *         description: Invalid request or path
     *       404:
     *         description: Directory not found
     */
    router.get(
        '/api/local/download-all',
        isAuthenticated,
        asyncHandler(async (req, res) => {
            const requestedPath = String(req.query.path || '').trim();
            if (!requestedPath) {
                return res.status(400).json({ error: 'Missing path' });
            }
            try {
                const base = path.resolve(config.localDirectory.rootPath);
                let dirPath;
                if (path.isAbsolute(requestedPath)) {
                    const abs = path.resolve(requestedPath);
                    dirPath = abs.startsWith(base)
                        ? abs
                        : path.resolve(base, requestedPath.replace(/^\/+/, ''));
                } else {
                    dirPath = path.resolve(base, requestedPath);
                }
                // ensure within base
                const within = dirPath === base || (dirPath + path.sep).startsWith(base + path.sep);
                if (!within) return res.status(400).json({ error: 'Invalid path' });

                const st = await fs.promises.stat(dirPath).catch(() => null);
                if (!st || !st.isDirectory())
                    return res.status(404).json({ error: 'Directory not found' });

                const folderName = path.basename(dirPath) || 'download';
                const limits = getZipLimits();
                const createIterator = createDirectoryFileWalker(dirPath, limits);

                try {
                    await preflightZipLimits(createIterator, limits);
                } catch (e) {
                    if (e && e.code === 'zip_limits_exceeded') {
                        return res.status(413).json({
                            error: 'zip_limits_exceeded',
                            reason: e.reason,
                            limit: e.limit,
                            file: e.file,
                        });
                    }
                    throw e;
                }

                const ts = new Date();
                const pad = n => String(n).padStart(2, '0');
                const date = `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`;
                const filename = `${folderName}-${date}.zip`;
                res.setHeader('Content-Type', 'application/zip');
                res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

                const archive = archiver('zip', { zlib: { level: 6 } });
                archive.on('warning', err => {
                    logger.warn('Local directory zip warning:', err);
                });
                archive.on('error', err => {
                    logger.error('Local directory zip error:', err);
                    if (!res.headersSent) {
                        res.status(500).json({ error: 'zip_failed' });
                    } else {
                        res.destroy(err);
                    }
                });

                archive.pipe(res);
                for await (const file of createIterator()) {
                    archive.file(file.absPath, { name: zipJoin(folderName, file.relPath) });
                }
                archive.finalize();
            } catch (error) {
                logger.error('Local directory zip download error:', error);
                return res.status(500).json({ error: 'zip_failed' });
            }
        })
    );

    /**
     * @swagger
     * /api/local/bulk-download:
     *   post:
     *     summary: Download multiple files as a single ZIP
     *     description: Creates a ZIP archive containing selected files and streams it to the client
     *     tags: ['Local Directory']
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [paths]
     *             properties:
     *               paths:
     *                 type: array
     *                 items:
     *                   type: string
     *                 description: Array of file paths to include in the ZIP
     *     responses:
     *       200:
     *         description: ZIP stream
     *       400:
     *         description: Invalid request
     *       404:
     *         description: File(s) not found
     */
    router.post(
        '/api/local/bulk-download',
        isAuthenticated,
        express.json(),
        asyncHandler(async (req, res) => {
            const { paths = [] } = req.body;

            if (!Array.isArray(paths) || paths.length === 0) {
                return res.status(400).json({ error: 'No paths provided' });
            }

            try {
                const base = path.resolve(config.localDirectory.rootPath);
                const limits = getZipLimits();

                const files = [];
                let totalBytes = 0;

                for (const requestedPath of paths) {
                    const trimmedPath = String(requestedPath).trim();
                    if (!trimmedPath) continue;

                    let fullPath;
                    if (path.isAbsolute(trimmedPath)) {
                        const abs = path.resolve(trimmedPath);
                        fullPath = abs.startsWith(base)
                            ? abs
                            : path.resolve(base, trimmedPath.replace(/^\/+/, ''));
                    } else {
                        fullPath = path.resolve(base, trimmedPath);
                    }

                    const within =
                        fullPath === base || (fullPath + path.sep).startsWith(base + path.sep);
                    if (!within) {
                        logger.warn('Bulk download: skipping invalid path', {
                            path: requestedPath,
                        });
                        continue;
                    }

                    const st = await fs.promises.stat(fullPath).catch(() => null);
                    if (!st || !st.isFile()) {
                        logger.warn('Bulk download: file not found or not a file', {
                            path: requestedPath,
                        });
                        continue;
                    }

                    if (st.size > limits.maxSingleFileBytes) {
                        return res.status(413).json({
                            error: 'zip_limits_exceeded',
                            reason: 'max_single_file_bytes',
                            limit: limits.maxSingleFileBytes,
                            file: path.relative(base, fullPath),
                        });
                    }

                    files.push({
                        fullPath,
                        name: path.relative(base, fullPath).replace(/\\/g, '/'),
                        size: st.size,
                    });
                    totalBytes += st.size;

                    if (files.length > limits.maxFiles) {
                        return res.status(413).json({
                            error: 'zip_limits_exceeded',
                            reason: 'max_files',
                            limit: limits.maxFiles,
                        });
                    }
                    if (totalBytes > limits.maxBytes) {
                        return res.status(413).json({
                            error: 'zip_limits_exceeded',
                            reason: 'max_bytes',
                            limit: limits.maxBytes,
                        });
                    }
                }

                if (files.length === 0) {
                    return res.status(404).json({ error: 'No valid files found' });
                }

                const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
                const filename = `posterrama-files-${timestamp}.zip`;

                res.setHeader('Content-Type', 'application/zip');
                res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

                const archive = archiver('zip', { zlib: { level: 6 } });
                archive.on('warning', err => {
                    logger.warn('Bulk download zip warning:', err);
                });
                archive.on('error', err => {
                    logger.error('Bulk download zip error:', err);
                    if (!res.headersSent) {
                        res.status(500).json({ error: 'zip_failed' });
                    } else {
                        res.destroy(err);
                    }
                });

                archive.pipe(res);
                for (const f of files) {
                    archive.file(f.fullPath, { name: f.name });
                }
                archive.finalize();
            } catch (error) {
                logger.error('Bulk download error:', error);
                res.status(500).json({ error: 'Download failed' });
            }
        })
    );

    /**
     * @swagger
     * /api/local/bulk-delete:
     *   post:
     *     summary: Delete multiple files
     *     description: Deletes multiple files using the cleanup endpoint
     *     tags: ['Local Directory']
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [paths]
     *             properties:
     *               paths:
     *                 type: array
     *                 items:
     *                   type: string
     *                 description: Array of file paths to delete
     *     responses:
     *       200:
     *         description: Files deleted
     *       400:
     *         description: Invalid request
     */
    router.post(
        '/api/local/bulk-delete',
        isAuthenticated,
        express.json(),
        asyncHandler(async (req, res) => {
            if (!localDirectorySource) {
                return res.status(404).json({ error: 'Local directory support not enabled' });
            }

            const { paths = [] } = req.body;

            if (!Array.isArray(paths) || paths.length === 0) {
                return res.status(400).json({ error: 'No paths provided' });
            }

            try {
                const operations = paths.map(p => ({ type: 'delete', path: p }));
                const results = await localDirectorySource.cleanupDirectory(operations, false);

                // After destructive operations, refresh playlist/media cache
                try {
                    if (cacheManager && typeof cacheManager.clear === 'function') {
                        cacheManager.clear('media');
                    }
                    Promise.resolve(refreshPlaylistCache()).catch(err => {
                        logger.debug(
                            'refreshPlaylistCache after bulk delete failed (ignored):',
                            err?.message || err
                        );
                    });
                } catch (e) {
                    logger.debug('Post-bulk-delete cache nudge failed (ignored):', e?.message || e);
                }

                // Count successful deletions
                const deleted =
                    results.operations?.filter(op => op.status === 'deleted').length ||
                    paths.length;

                res.json({
                    success: true,
                    deleted,
                    results,
                });
            } catch (error) {
                logger.error('Bulk delete error:', error);
                res.status(500).json({ error: error.message || 'Delete failed' });
            }
        })
    );

    /**
     * @swagger
     * /api/local/import-posterpacks:
     *   post:
     *     summary: Manage posterpack ZIPs (ZIP-only)
     *     description: ZIPs are never extracted. By default this operation does nothing (manual ZIPs already live under complete/manual). When includeGenerated=true, it copies any ZIPs from complete/plex-export and complete/jellyfin-export into complete/manual for safekeeping.
     *     tags: ['Local Directory']
     *     requestBody:
     *       required: false
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               includeGenerated:
     *                 type: boolean
     *                 description: Also import from generated export folders (plex-export, jellyfin-export)
     *                 default: true
     *               refresh:
     *                 type: boolean
     *                 description: Trigger a playlist refresh after import
     *                 default: true
     *     responses:
     *       200:
     *         description: Import completed
     *       404:
     *         description: Local directory not enabled
     */
    router.post(
        '/api/local/import-posterpacks',
        express.json(),
        asyncHandler(async (req, res) => {
            if (!config.localDirectory?.enabled || !localDirectorySource) {
                return res.status(404).json({ error: 'Local directory support not enabled' });
            }
            const { includeGenerated = false, refresh = true } = req.body || {};
            try {
                const imported = await localDirectorySource.importPosterpacks({ includeGenerated });
                if (refresh) {
                    try {
                        await refreshPlaylistCache();
                    } catch (_) {
                        /* non-fatal */
                    }
                }
                return res.json({ success: true, imported });
            } catch (e) {
                logger.error('Local import-posterpacks failed:', e);
                return res.status(500).json({ error: e.message || 'import_failed' });
            }
        })
    );

    /**
     * @swagger
     * /api/local/upload:
     *   post:
     *     summary: Upload media files to local directory
     *     description: Upload one or more media files with automatic organization. For posterpack ZIPs, use targetDirectory=complete (stored under complete/manual).
     *     tags: ['Local Directory']
     *     requestBody:
     *       required: true
     *       content:
     *         multipart/form-data:
     *           schema:
     *             type: object
     *             properties:
     *               files:
     *                 type: array
     *                 items:
     *                   type: string
     *                   format: binary
     *               targetPath:
     *                 type: string
     *                 description: Target directory path
     *     responses:
     *       200:
     *         description: Upload successful
     *       400:
     *         description: Invalid request or files
     *       500:
     *         description: Upload failed
     */
    router.post('/api/local/upload', (req, res) => {
        // Permit uploading even if Local source is disabled for playlist purposes.
        if (!uploadMiddleware) {
            return res.status(404).json({ error: 'Local directory support not enabled' });
        }

        uploadMiddleware(req, res, err => {
            if (err) {
                logger.error('Upload error:', err);
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(400).json({ error: 'File size too large' });
                } else if (err.code === 'INVALID_FILE_TYPE') {
                    return res.status(400).json({ error: err.message });
                }
                return res.status(500).json({ error: err.message });
            }
            try {
                const uploadedFiles = req.files || [];
                const targetDirectory =
                    req.body?.targetDirectory || req.query?.targetDirectory || 'posters';
                const targetPath = req.uploadTargetPath || '';

                if (!uploadedFiles.length) {
                    return res.status(400).json({ success: false, error: 'No files uploaded' });
                }

                logger.info(
                    `Upload completed: ${uploadedFiles.length} files to ${targetDirectory} (${targetPath})`
                );

                const payload = {
                    success: true,
                    uploadedFiles: uploadedFiles.map(file => ({
                        filename: file.filename,
                        originalName: file.originalname,
                        size: file.size,
                        path: file.path,
                    })),
                    targetDirectory,
                    targetPath,
                };

                // Nudge playlist/media cache so UI pills and screensaver pick up new files immediately
                try {
                    if (cacheManager && typeof cacheManager.clear === 'function') {
                        cacheManager.clear('media');
                    }
                    // Fire-and-forget refresh (does its own locking); do not block upload response
                    Promise.resolve(refreshPlaylistCache()).catch(err => {
                        // Non-fatal: background refresh is best-effort after upload
                        logger.debug(
                            'refreshPlaylistCache after upload failed (ignored):',
                            err?.message || err
                        );
                    });
                } catch (e) {
                    // Non-fatal: cache nudge after upload failed; upload still considered successful
                    logger.debug('Post-upload cache nudge failed (ignored):', e?.message || e);
                }

                res.json(payload);
            } catch (e) {
                logger.error('Upload post-processing error:', e);
                res.status(500).json({ success: false, error: 'Upload processing failed' });
            }
        });
    });

    /**
     * @swagger
     * /api/local/cleanup:
     *   post:
     *     summary: Clean up local directory
     *     description: Remove empty directories, duplicate files, and orphaned metadata
     *     tags: ['Local Directory']
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               operations:
     *                 type: array
     *                 items:
     *                   type: string
     *                   enum: [empty-directories, duplicates, orphaned-metadata, unused-images]
     *                 description: Cleanup operations to perform
     *               dryRun:
     *                 type: boolean
     *                 description: Perform dry run without making changes
     *     responses:
     *       200:
     *         description: Cleanup completed
     *       400:
     *         description: Invalid request
     *       500:
     *         description: Cleanup failed
     */
    router.post(
        '/api/local/cleanup',
        express.json(),
        asyncHandler(async (req, res) => {
            // Permit cleanup/delete even if Local source is disabled for playlist purposes.
            if (!localDirectorySource) {
                return res.status(404).json({ error: 'Local directory support not enabled' });
            }

            const { operations = [], dryRun = false } = req.body;

            if (!Array.isArray(operations) || operations.length === 0) {
                return res.status(400).json({ error: 'No cleanup operations specified' });
            }

            try {
                const results = await localDirectorySource.cleanupDirectory(operations, dryRun);
                // After destructive operations, refresh playlist/media cache so UI reflects current state
                try {
                    if (!dryRun) {
                        if (cacheManager && typeof cacheManager.clear === 'function') {
                            cacheManager.clear('media');
                        }
                        Promise.resolve(refreshPlaylistCache()).catch(err => {
                            // Non-fatal: background refresh is best-effort after cleanup
                            logger.debug(
                                'refreshPlaylistCache after cleanup failed (ignored):',
                                err?.message || err
                            );
                        });
                    }
                } catch (e) {
                    // Non-fatal: cache clear/refresh after cleanup failed
                    logger.debug('Post-cleanup cache nudge failed (ignored):', e?.message || e);
                }
                res.json({
                    success: true,
                    dryRun: dryRun,
                    results: results,
                });
            } catch (error) {
                logger.error('Cleanup error:', error);
                res.status(500).json({ error: error.message });
            }
        })
    );

    /**
     * @swagger
     * /api/local/generate-posterpack:
     *   post:
     *     summary: Generate posterpack from media servers
     *     description: Create ZIP archives of posters and metadata from Plex/Jellyfin libraries
     *     tags: ['Local Directory']
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [sourceType, libraryIds]
     *             properties:
     *               sourceType:
     *                 type: string
     *                 enum: [plex, jellyfin]
     *                 description: Source media server type
     *               libraryIds:
     *                 type: array
     *                 items:
     *                   type: string
     *                 description: Array of library IDs to process
     *               options:
     *                 type: object
     *                 description: Generation options
     *                 properties:
     *                   includeAssets:
     *                     type: object
     *                     description: Asset types to include
     *                   outputNaming:
     *                     type: string
     *                     description: Output filename template
     *     responses:
     *       200:
     *         description: Generation job started
     *       400:
     *         description: Invalid request
     *       404:
     *         description: Local directory or job queue not available
     *       500:
     *         description: Generation failed to start
     */
    router.post(
        '/api/local/generate-posterpack',
        express.json(),
        asyncHandler(async (req, res) => {
            if (!config.localDirectory?.enabled || !jobQueue) {
                return res
                    .status(404)
                    .json({ error: 'Local directory support or job queue not available' });
            }

            const { sourceType, libraryIds, options = {} } = req.body;

            if (!sourceType || !libraryIds || !Array.isArray(libraryIds)) {
                return res
                    .status(400)
                    .json({ error: 'sourceType and libraryIds array are required' });
            }

            if (!['plex', 'jellyfin', 'local'].includes(sourceType)) {
                return res
                    .status(400)
                    .json({ error: 'sourceType must be plex, jellyfin, or local' });
            }

            try {
                const jobId = await jobQueue.addPosterpackGenerationJob(
                    sourceType,
                    libraryIds,
                    options
                );

                res.json({
                    success: true,
                    jobId: jobId,
                    message: 'Posterpack generation job started',
                    sourceType: sourceType,
                    libraryCount: libraryIds.length,
                });
            } catch (error) {
                logger.error('Posterpack generation error:', error);
                res.status(500).json({ error: error.message });
            }
        })
    );

    /**
     * @swagger
     * /api/local/preview-posterpack:
     *   post:
     *     summary: Preview posterpack generation
     *     description: Estimate how many items would be included based on selected source and libraries
     *     tags: ['Local Directory']
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [sourceType]
     *             properties:
     *               sourceType:
     *                 type: string
     *                 enum: [plex, jellyfin, local]
     *               libraryIds:
     *                 type: array
     *                 items:
     *                   type: string
     *               mediaType:
     *                 type: string
     *               yearRange:
     *                 type: object
     *               limit:
     *                 type: number
     *     responses:
     *       200:
     *         description: Preview data
     *       400:
     *         description: Invalid request
     */
    router.post(
        '/api/local/preview-posterpack',
        express.json(),
        asyncHandler(async (req, res) => {
            if (!config.localDirectory?.enabled) {
                return res.status(404).json({ error: 'Local directory support not enabled' });
            }

            const { sourceType, libraryIds = [], options = {} } = req.body || {};
            const mediaType = options.mediaType || 'all';
            // Use a higher default preview limit; UI hides limit for Local
            const limit = Number(options.limit) || 10000;
            const yearFilterExpr = (options.yearFilter || '').trim();
            const filtersPlex = options.filtersPlex || {};
            const filtersJellyfin = options.filtersJellyfin || {};
            const filtersLocal = options.filtersLocal || {};

            if (!sourceType) return res.status(400).json({ error: 'sourceType is required' });

            const clamp = (n, max) => (Number.isFinite(n) ? Math.max(0, Math.min(n, max)) : 0);

            try {
                let totalItems = 0;
                const perLibrary = [];

                if (sourceType === 'plex') {
                    const serverConfig = (config.mediaServers || []).find(s => s.type === 'plex');
                    if (!serverConfig)
                        return res.status(400).json({ error: 'No Plex server configured' });
                    const plex = await getPlexClient(serverConfig);
                    // Build filter helpers
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
                    const f = {
                        years: (yearFilterExpr || filtersPlex.years || '').trim(),
                        genres: parseCsv(filtersPlex.genres),
                        ratings: parseCsv(filtersPlex.ratings).map(r => r.toUpperCase()),
                        qualities: parseCsv(filtersPlex.qualities),
                    };
                    const yearOk = yearTester(f.years);
                    for (const id of libraryIds) {
                        try {
                            // For estimation respecting filters, we need to scan items (shallow) and apply filters
                            let start = 0;
                            const pageSize = Math.max(
                                1,
                                Number(process.env.PLEX_PREVIEW_PAGE_SIZE) || 200
                            );
                            let total = 0;
                            let matched = 0;
                            do {
                                const q = `/library/sections/${id}/all?X-Plex-Container-Start=${start}&X-Plex-Container-Size=${pageSize}`;
                                const resp = await plex.query(q);
                                const mc = resp?.MediaContainer;
                                const items = Array.isArray(mc?.Metadata) ? mc.Metadata : [];
                                total = Number(mc?.totalSize || mc?.size || start + items.length);
                                for (const it of items) {
                                    // Years
                                    if (yearOk) {
                                        let y = undefined;
                                        if (it.year != null) {
                                            const yy = Number(it.year);
                                            y = Number.isFinite(yy) ? yy : undefined;
                                        }
                                        if (y == null && it.originallyAvailableAt) {
                                            const d = new Date(it.originallyAvailableAt);
                                            if (!Number.isNaN(d.getTime())) y = d.getFullYear();
                                        }
                                        if (y == null && it.firstAired) {
                                            const d = new Date(it.firstAired);
                                            if (!Number.isNaN(d.getTime())) y = d.getFullYear();
                                        }
                                        if (y == null || !yearOk(y)) continue;
                                    }
                                    // Genres
                                    if (f.genres.length) {
                                        const g = Array.isArray(it.Genre)
                                            ? it.Genre.map(x =>
                                                  x && x.tag ? String(x.tag).toLowerCase() : ''
                                              )
                                            : [];
                                        if (
                                            !f.genres.some(need =>
                                                g.includes(String(need).toLowerCase())
                                            )
                                        )
                                            continue;
                                    }
                                    // Ratings
                                    if (f.ratings.length) {
                                        const r = it.contentRating
                                            ? String(it.contentRating).trim().toUpperCase()
                                            : null;
                                        if (!r || !f.ratings.includes(r)) continue;
                                    }
                                    // Qualities
                                    if (f.qualities.length) {
                                        const medias = Array.isArray(it.Media) ? it.Media : [];
                                        let ok = false;
                                        for (const m of medias) {
                                            const label = mapResToLabel(m?.videoResolution);
                                            if (f.qualities.includes(label)) {
                                                ok = true;
                                                break;
                                            }
                                        }
                                        if (!ok) continue;
                                    }
                                    matched++;
                                }
                                start += items.length;
                            } while (start < total && pageSize > 0);
                            perLibrary.push({ id, count: matched });
                            totalItems += matched;
                        } catch (e) {
                            perLibrary.push({ id, count: 0, error: e.message });
                        }
                    }
                } else if (sourceType === 'jellyfin') {
                    const serverConfig = (config.mediaServers || []).find(
                        s => s.type === 'jellyfin'
                    );
                    if (!serverConfig)
                        return res.status(400).json({ error: 'No Jellyfin server configured' });
                    const client = await getJellyfinClient(serverConfig);
                    // Build filter helpers
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
                    const f = {
                        years: (yearFilterExpr || filtersJellyfin.years || '').trim(),
                        genres: parseCsv(filtersJellyfin.genres),
                        ratings: parseCsv(filtersJellyfin.ratings).map(r => r.toUpperCase()),
                    };
                    const yearOk = yearTester(f.years);
                    for (const id of libraryIds) {
                        try {
                            // Page and apply filters to estimate count
                            const pageSize = Math.max(
                                1,
                                Number(process.env.JF_PREVIEW_PAGE_SIZE) || 1000
                            );
                            let startIndex = 0;
                            let matched = 0;
                            let fetched;
                            do {
                                const page = await client.getItems({
                                    parentId: id,
                                    includeItemTypes: ['Movie', 'Series'],
                                    recursive: true,
                                    // We don't need MediaStreams since we aren't filtering qualities here
                                    fields: [
                                        'Genres',
                                        'OfficialRating',
                                        'ProductionYear',
                                        'PremiereDate',
                                    ],
                                    sortBy: [],
                                    limit: pageSize,
                                    startIndex,
                                });
                                const items = Array.isArray(page?.Items) ? page.Items : [];
                                fetched = items.length;
                                startIndex += fetched;
                                for (const it of items) {
                                    // Year
                                    if (yearOk) {
                                        let y = undefined;
                                        if (it.ProductionYear != null) {
                                            const yy = Number(it.ProductionYear);
                                            y = Number.isFinite(yy) ? yy : undefined;
                                        }
                                        if (y == null && it.PremiereDate) {
                                            const d = new Date(it.PremiereDate);
                                            if (!Number.isNaN(d.getTime())) y = d.getFullYear();
                                        }
                                        if (y == null || !yearOk(y)) continue;
                                    }
                                    // Genres
                                    if (f.genres.length) {
                                        const g = Array.isArray(it.Genres)
                                            ? it.Genres.map(x => String(x).toLowerCase())
                                            : [];
                                        if (
                                            !f.genres.some(need =>
                                                g.includes(String(need).toLowerCase())
                                            )
                                        )
                                            continue;
                                    }
                                    // Ratings (MPAA/TV)
                                    if (f.ratings.length) {
                                        const r = it.OfficialRating
                                            ? String(it.OfficialRating).trim().toUpperCase()
                                            : null;
                                        if (!r || !f.ratings.includes(r)) continue;
                                    }
                                    matched++;
                                }
                            } while (fetched === pageSize);
                            perLibrary.push({ id, count: matched });
                            totalItems += matched;
                        } catch (e) {
                            perLibrary.push({ id, count: 0, error: e.message });
                        }
                    }
                } else if (sourceType === 'local') {
                    totalItems = 0;
                }

                const preview = {
                    summary: {
                        sourceType,
                        totalItems,
                        mediaType,
                        limit,
                        filters: {
                            yearFilter: yearFilterExpr,
                            plex: filtersPlex,
                            jellyfin: filtersJellyfin,
                            local: filtersLocal,
                        },
                    },
                    libraries: perLibrary,
                    estimatedToGenerate: clamp(Math.min(totalItems, limit), 10000),
                };
                return res.json(preview);
            } catch (error) {
                logger.error('Preview posterpack failed:', error);
                res.status(500).json({ error: error.message });
            }
        })
    );

    /**
     * @swagger
     * /api/local/posterpacks:
     *   get:
     *     summary: List generated posterpacks
     *     description: Return generated posterpack ZIP files for the given source (plex/jellyfin/local)
     *     tags: ['Local Directory']
     *     parameters:
     *       - in: query
     *         name: source
     *         required: true
     *         schema:
     *           type: string
     *           enum: [plex, jellyfin, local]
     *         description: Source type to list
     *     responses:
     *       200:
     *         description: List of ZIP files
     */
    router.get(
        '/api/local/posterpacks',
        isAuthenticated,
        asyncHandler(async (req, res) => {
            try {
                if (!config.localDirectory?.enabled) {
                    return res.status(404).json({ error: 'Local directory support not enabled' });
                }
                const source = String(req.query.source || '').toLowerCase();
                if (!['plex', 'jellyfin', 'local'].includes(source)) {
                    return res.status(400).json({ error: 'Invalid source' });
                }
                const base = path.resolve(config.localDirectory.rootPath);
                const exportDir = path.join(base, 'complete', `${source}-export`);
                await fs.promises.mkdir(exportDir, { recursive: true });
                const entries = await fs.promises.readdir(exportDir);
                const files = [];
                for (const name of entries) {
                    if (!name.toLowerCase().endsWith('.zip')) continue;
                    const full = path.join(exportDir, name);
                    const st = await fs.promises.stat(full).catch(() => null);
                    if (!st || !st.isFile()) continue;
                    files.push({
                        name,
                        size: st.size,
                        mtime: st.mtimeMs,
                        downloadUrl: `/api/local/posterpacks/download?source=${encodeURIComponent(source)}&file=${encodeURIComponent(name)}`,
                    });
                }
                // Sort newest first
                files.sort((a, b) => b.mtime - a.mtime);
                res.json({ files });
            } catch (e) {
                logger.error('List posterpacks failed:', e);
                res.status(500).json({ error: 'list_failed' });
            }
        })
    );

    /**
     * @swagger
     * /api/local/posterpacks/download:
     *   get:
     *     summary: Download a single posterpack ZIP
     *     tags: ['Local Directory']
     *     parameters:
     *       - in: query
     *         name: source
     *         required: true
     *         schema:
     *           type: string
     *           enum: [plex, jellyfin, local]
     *       - in: query
     *         name: file
     *         required: true
     *         schema:
     *           type: string
     */
    router.get(
        '/api/local/posterpacks/download',
        isAuthenticated,
        asyncHandler(async (req, res) => {
            try {
                const source = String(req.query.source || '').toLowerCase();
                const file = String(req.query.file || '');
                if (!['plex', 'jellyfin', 'local'].includes(source) || !file.endsWith('.zip')) {
                    return res.status(400).json({ error: 'Invalid parameters' });
                }
                const base = path.resolve(config.localDirectory.rootPath);
                const exportDir = path.join(base, 'complete', `${source}-export`);
                const full = path.join(exportDir, path.basename(file));
                // Ensure path is within exportDir
                if (!full.startsWith(exportDir))
                    return res.status(400).json({ error: 'Invalid path' });
                return res.download(full);
            } catch (e) {
                logger.error('Download posterpack failed:', e);
                res.status(500).json({ error: 'download_failed' });
            }
        })
    );

    /**
     * @swagger
     * /api/local/posterpacks/download-all:
     *   get:
     *     summary: Download all posterpacks for a source as a ZIP
     *     tags: ['Local Directory']
     *     parameters:
     *       - in: query
     *         name: source
     *         required: true
     *         schema:
     *           type: string
     *           enum: [plex, jellyfin, local]
     */
    router.get(
        '/api/local/posterpacks/download-all',
        isAuthenticated,
        asyncHandler(async (req, res) => {
            try {
                const source = String(req.query.source || '').toLowerCase();
                if (!['plex', 'jellyfin', 'local'].includes(source)) {
                    return res.status(400).json({ error: 'Invalid source' });
                }
                const base = path.resolve(config.localDirectory.rootPath);
                const exportDir = path.join(base, 'complete', `${source}-export`);
                await fs.promises.mkdir(exportDir, { recursive: true });
                const entries = await fs.promises.readdir(exportDir);

                const limits = getZipLimits();
                const posterpacks = [];
                let totalBytes = 0;
                for (const name of entries) {
                    if (!name.toLowerCase().endsWith('.zip')) continue;
                    const full = path.join(exportDir, name);
                    const st = await fs.promises.stat(full).catch(() => null);
                    if (!st || !st.isFile()) continue;

                    if (st.size > limits.maxSingleFileBytes) {
                        return res.status(413).json({
                            error: 'zip_limits_exceeded',
                            reason: 'max_single_file_bytes',
                            limit: limits.maxSingleFileBytes,
                            file: name,
                        });
                    }

                    posterpacks.push({ full, name, size: st.size });
                    totalBytes += st.size;

                    if (posterpacks.length > limits.maxFiles) {
                        return res.status(413).json({
                            error: 'zip_limits_exceeded',
                            reason: 'max_files',
                            limit: limits.maxFiles,
                        });
                    }
                    if (totalBytes > limits.maxBytes) {
                        return res.status(413).json({
                            error: 'zip_limits_exceeded',
                            reason: 'max_bytes',
                            limit: limits.maxBytes,
                        });
                    }
                }

                if (posterpacks.length === 0) {
                    return res.status(404).json({ error: 'No posterpacks found' });
                }

                const filename = `${source}-posterpacks-${Date.now()}.zip`;
                res.setHeader('Content-Type', 'application/zip');
                res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

                const archive = archiver('zip', { zlib: { level: 6 } });
                archive.on('warning', err => {
                    logger.warn('Posterpacks zip warning:', err);
                });
                archive.on('error', err => {
                    logger.error('Posterpacks zip error:', err);
                    if (!res.headersSent) {
                        res.status(500).json({ error: 'download_all_failed' });
                    } else {
                        res.destroy(err);
                    }
                });

                archive.pipe(res);
                for (const p of posterpacks) {
                    archive.file(p.full, { name: p.name });
                }
                archive.finalize();
            } catch (e) {
                logger.error('Download-all posterpacks failed:', e);
                res.status(500).json({ error: 'download_all_failed' });
            }
        })
    );
    /**
     * @swagger
     * /api/local/jobs/{jobId}:
     *   get:
     *     summary: Get job status and progress
     *     description: Retrieve detailed information about a specific background job
     *     tags: ['Local Directory']
     *     parameters:
     *       - in: path
     *         name: jobId
     *         required: true
     *         schema:
     *           type: string
     *         description: Job ID
     *     responses:
     *       200:
     *         description: Job information
     *       404:
     *         description: Job not found
     */
    router.get('/api/local/jobs/:jobId', (req, res) => {
        if (!jobQueue) {
            return res.status(404).json({ error: 'Job queue not available' });
        }

        const { jobId } = req.params;
        const job = jobQueue.getJob(jobId);

        if (!job) {
            return res.status(404).json({ error: 'Job not found' });
        }

        res.json(job);
    });

    /**
     * @swagger
     * /api/local/jobs:
     *   get:
     *     summary: List all jobs
     *     description: Get list of all background jobs with optional status filtering
     *     tags: ['Local Directory']
     *     parameters:
     *       - in: query
     *         name: status
     *         schema:
     *           type: string
     *           enum: [queued, running, completed, failed, cancelled]
     *         description: Filter jobs by status
     *     responses:
     *       200:
     *         description: List of jobs
     */
    router.get('/api/local/jobs', (req, res) => {
        if (!jobQueue) {
            return res.status(404).json({ error: 'Job queue not available' });
        }

        const { status } = req.query;
        const jobs = jobQueue.getAllJobs(status);

        res.json({
            jobs: jobs,
            statistics: jobQueue.getStatistics(),
        });
    });

    /**
     * @swagger
     * /api/local/jobs/{jobId}/cancel:
     *   post:
     *     summary: Cancel a queued job
     *     description: Cancel a job that is currently in the queue (not yet running)
     *     tags: ['Local Directory']
     *     parameters:
     *       - in: path
     *         name: jobId
     *         required: true
     *         schema:
     *           type: string
     *         description: Job ID to cancel
     *     responses:
     *       200:
     *         description: Job cancelled successfully
     *       400:
     *         description: Job cannot be cancelled (not queued)
     *       404:
     *         description: Job not found
     */
    router.post('/api/local/jobs/:jobId/cancel', (req, res) => {
        if (!jobQueue) {
            return res.status(404).json({ error: 'Job queue not available' });
        }

        const { jobId } = req.params;
        const cancelled = jobQueue.cancelJob(jobId);

        if (cancelled) {
            res.json({ success: true, message: 'Job cancelled successfully' });
        } else {
            const job = jobQueue.getJob(jobId);
            if (!job) {
                res.status(404).json({ error: 'Job not found' });
            } else {
                res.status(400).json({
                    error: 'Job cannot be cancelled',
                    status: job.status,
                });
            }
        }
    });

    /**
     * @swagger
     * /api/local/metadata:
     *   get:
     *     summary: Get metadata for local media files
     *     description: Retrieve or generate metadata for files in the local directory
     *     tags: ['Local Directory']
     *     parameters:
     *       - in: query
     *         name: path
     *         schema:
     *           type: string
     *         description: File or directory path
     *       - in: query
     *         name: refresh
     *         schema:
     *           type: boolean
     *         description: Force refresh metadata from external sources
     *     responses:
     *       200:
     *         description: Metadata information
     *       404:
     *         description: File not found or no metadata available
     *       500:
     *         description: Metadata retrieval failed
     */
    router.get(
        '/api/local/metadata',
        asyncHandler(async (req, res) => {
            if (!config.localDirectory?.enabled || !localDirectorySource) {
                return res.status(404).json({ error: 'Local directory support not enabled' });
            }

            const { path: filePath = '', refresh = false } = req.query;

            try {
                const metadata = await localDirectorySource.getFileMetadata(filePath, refresh);
                res.json(metadata);
            } catch (error) {
                logger.error('Metadata retrieval error:', error);
                if (error.code === 'ENOENT') {
                    res.status(404).json({ error: 'File not found' });
                } else {
                    res.status(500).json({ error: error.message });
                }
            }
        })
    );

    /**
     * @swagger
     * /api/local/stats:
     *   get:
     *     summary: Get local directory statistics
     *     description: Retrieve usage statistics and summary information
     *     tags: ['Local Directory']
     *     responses:
     *       200:
     *         description: Directory statistics
     *       404:
     *         description: Local directory support not enabled
     */
    router.get(
        '/api/local/stats',
        asyncHandler(async (req, res) => {
            if (!config.localDirectory?.enabled || !localDirectorySource) {
                return res.status(404).json({ error: 'Local directory support not enabled' });
            }

            try {
                const stats = await localDirectorySource.getDirectoryStats();
                const jobStats = jobQueue ? jobQueue.getStatistics() : null;

                res.json({
                    directory: stats,
                    jobs: jobStats,
                });
            } catch (error) {
                logger.error('Stats retrieval error:', error);
                res.status(500).json({ error: error.message });
            }
        })
    );

    return router;
};
