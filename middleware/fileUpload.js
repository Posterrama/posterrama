const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const mimeTypes = require('mime-types');
const FileType = require('file-type');
const AdmZip = require('adm-zip');
const logger = require('../utils/logger');

/**
 * File Upload Middleware for Local Directory Support
 * Handles multi-file uploads with validation, clean filename generation, and security
 */

/**
 * Generate clean, URL-safe filename
 * @param {string} originalName - Original filename
 * @returns {string} Clean filename
 */
function generateCleanFilename(originalName) {
    const parsed = path.parse(originalName);
    const nameWithoutExt = parsed.name;
    const ext = parsed.ext;

    // Clean filename
    const cleanName = nameWithoutExt
        .replace(/[<>:"/\\|?*]/g, '') // Remove invalid characters
        .replace(/-+/g, '-') // Normalize hyphens
        .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
        .trim();

    return (cleanName || 'file') + ext.toLowerCase();
}

/**
 * Validate file path for security (prevent directory traversal)
 * @param {string} filePath - File path to validate
 * @returns {boolean} True if path is safe
 */
function validateFilePath(filePath) {
    // Prevent directory traversal
    if (filePath.includes('..') || filePath.includes('~')) {
        return false;
    }

    // Check for null bytes
    if (filePath.includes('\0')) {
        return false;
    }

    // Must be a relative path (no leading slash)
    if (path.isAbsolute(filePath)) {
        return false;
    }

    return true;
}

/**
 * Create multer storage configuration
 * @param {Object} config - Application configuration
 * @returns {Object} Multer storage configuration
 */
function createStorage(config) {
    // Accept either full app config or the localDirectory sub-config
    const ld = (config && config.localDirectory) || config || {};
    return multer.diskStorage({
        destination: async (req, file, cb) => {
            try {
                // Get target directory from request
                const targetDirectory =
                    (req.body && req.body.targetDirectory) ||
                    (req.query && req.query.targetDirectory) ||
                    'posters';

                // Validate directory name
                const allowedDirectories = ['posters', 'backgrounds', 'motion', 'complete'];
                if (!allowedDirectories.includes(targetDirectory)) {
                    return cb(new Error(`Invalid target directory: ${targetDirectory}`));
                }

                // Construct full path
                const rootPath = ld.rootPath || path.resolve(process.cwd(), 'media');
                if (!rootPath) {
                    return cb(new Error('Local directory not configured'));
                }

                // Special-case: uploads to 'complete' go to a complete/* subfolder.
                // Default is complete/manual for back-compat.
                let completeSubdir = 'manual';
                if (targetDirectory === 'complete') {
                    const rawSubdir =
                        (req.body && (req.body.completeSubdir || req.body.complete_subdir)) ||
                        (req.query && (req.query.completeSubdir || req.query.complete_subdir)) ||
                        '';
                    if (rawSubdir) {
                        const candidate = String(rawSubdir).trim();
                        const allowed = [
                            'manual',
                            'plex-export',
                            'jellyfin-emby-export',
                            'jellyfin-export',
                            'tmdb-export',
                            'romm-export',
                        ];
                        const lower = candidate.toLowerCase();
                        if (!allowed.includes(lower)) {
                            return cb(new Error(`Invalid complete subfolder: ${candidate}`));
                        }
                        completeSubdir = lower;
                    }
                }

                const fullPath =
                    targetDirectory === 'complete'
                        ? path.join(rootPath, 'complete', completeSubdir)
                        : path.join(rootPath, targetDirectory);

                // Ensure directory exists
                await fs.ensureDir(fullPath);

                // Store target directory in request for later use
                req.uploadTargetDirectory = targetDirectory;
                req.uploadTargetPath = fullPath;
                if (targetDirectory === 'complete') {
                    req.uploadCompleteSubdir = completeSubdir;
                }

                logger.debug(`FileUpload: Target directory: ${fullPath}`);
                cb(null, fullPath);
            } catch (error) {
                logger.error('FileUpload: Destination error:', error);
                cb(error);
            }
        },

        filename: (req, file, cb) => {
            try {
                // Store original filename for metadata
                req.originalFilenames = req.originalFilenames || [];
                req.originalFilenames.push(file.originalname);

                // Generate clean filename
                const cleanName = generateCleanFilename(file.originalname);

                // Validate filename
                if (!validateFilePath(cleanName)) {
                    return cb(new Error(`Invalid filename: ${file.originalname}`));
                }

                logger.debug(`FileUpload: ${file.originalname} → ${cleanName}`);
                cb(null, cleanName);
            } catch (error) {
                logger.error('FileUpload: Filename generation error:', error);
                cb(error);
            }
        },
    });
}

/**
 * Create file filter function
 * @param {Object} config - Application configuration
 * @returns {Function} File filter function
 */
function createFileFilter(config) {
    // Accept either full app config or the localDirectory sub-config
    const ld = (config && config.localDirectory) || config || {};
    return (req, file, cb) => {
        try {
            // Determine target directory early; support both body and query (order-safe)
            const targetDirectory =
                (req.body && req.body.targetDirectory) ||
                (req.query && req.query.targetDirectory) ||
                req.uploadTargetDirectory ||
                'posters';

            // Per-target allowed extensions
            const allow = {
                posters: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'],
                backgrounds: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'],
                // Motion supports raw video uploads AND motion posterpack ZIPs
                motion: ['gif', 'mp4', 'webm', 'avi', 'mov', 'mkv', 'zip'],
                complete: ['zip'],
            };
            const fallbackFormats = ld.supportedFormats || [
                'jpg',
                'jpeg',
                'png',
                'webp',
                'gif',
                'bmp',
                'mp4',
                'webm',
                'avi',
                'zip',
            ];
            const supportedFormats = allow[targetDirectory] || fallbackFormats;

            // Extract file extension
            const ext = path.extname(file.originalname).toLowerCase().slice(1);

            // Check if extension is supported
            if (!supportedFormats.includes(ext)) {
                const error = /** @type {any} */ (
                    new Error(
                        `File type .${ext} not supported for ${targetDirectory}. Supported: ${supportedFormats.join(', ')}`
                    )
                );
                error.code = 'INVALID_FILE_TYPE';
                return cb(error, false);
            }

            // Additional MIME type check
            const expectedMimeType = mimeTypes.lookup(file.originalname);
            if (expectedMimeType && file.mimetype !== expectedMimeType) {
                logger.warn(
                    `FileUpload: MIME type mismatch for ${file.originalname}: ${file.mimetype} vs ${expectedMimeType}`
                );
            }

            logger.debug(`FileUpload: File type validation passed: ${file.originalname} (${ext})`);
            cb(null, true);
        } catch (error) {
            logger.error('FileUpload: File filter error:', error);
            cb(error, false);
        }
    };
}

/**
 * Create multer upload instance
 * @param {Object} config - Application configuration
 * @returns {Object} Configured multer instance
 */
function createUploadMiddleware(config) {
    const storage = createStorage(config);
    const fileFilter = createFileFilter(config);

    // Get limits from config
    const ld = (config && config.localDirectory) || config || {};
    const maxFileSize = ld.maxFileSize || 104857600; // 100MB
    const maxConcurrentUploads = (ld.security && ld.security.maxConcurrentUploads) || 5;

    const upload = multer({
        storage: storage,
        fileFilter: fileFilter,
        limits: {
            fileSize: maxFileSize,
            files: maxConcurrentUploads,
            fieldSize: 1024 * 1024, // 1MB for form fields
        },
    });

    return upload;
}

/**
 * Handle file upload completion
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} _next - Express next function (unused)
 */
async function handleUploadComplete(req, res, _next) {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No files uploaded',
            });
        }

        const uploadResults = [];
        const errors = [];

        // Process each uploaded file
        for (let i = 0; i < req.files.length; i++) {
            const file = req.files[i];
            const originalName = req.originalFilenames[i];
            const ext = path.extname(originalName).toLowerCase().slice(1);
            const targetDir = req.uploadTargetDirectory;

            try {
                // Extra strict validation for motion ZIP posterpacks uploaded into motion/
                // (must include poster.* + motion.* and be explicitly flagged in metadata.json)
                if (String(targetDir).toLowerCase() === 'motion' && ext === 'zip') {
                    const imageExts = ['jpg', 'jpeg', 'png', 'webp'];
                    const videoExts = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'm4v'];

                    /** @param {any} meta */
                    const isMotionZipMetadata = meta => {
                        if (!meta || typeof meta !== 'object') return false;
                        const packType = String(
                            meta.packType || meta.pack || meta.kind || meta.type || ''
                        ).toLowerCase();
                        const mediaType = String(
                            meta.mediaType || meta.media_kind || meta.media || ''
                        ).toLowerCase();
                        const isMotion =
                            meta.isMotionPoster === true ||
                            meta.motionPoster === true ||
                            packType.includes('motion') ||
                            packType === 'motion-movie' ||
                            packType === 'motionposter';
                        const isMovie =
                            mediaType === 'movie' ||
                            packType.includes('movie') ||
                            meta.isMovie === true;
                        return Boolean(isMotion && (isMovie || packType.includes('motion')));
                    };

                    /** @param {any} zip */
                    const readZipMetadata = zip => {
                        try {
                            const zipEntries = zip.getEntries();
                            const metaEntry = zipEntries.find(e =>
                                /^metadata\.json$/i.test(e.entryName)
                            );
                            if (!metaEntry) return null;
                            const content = zip.readAsText(metaEntry);
                            return JSON.parse(content);
                        } catch (_) {
                            return null;
                        }
                    };

                    const zip = new AdmZip(file.path);
                    const entries = zip.getEntries();

                    // Basic safety: disallow traversal/absolute paths inside the ZIP
                    for (const ent of entries) {
                        const n = String(ent.entryName || '');
                        if (
                            n.includes('..') ||
                            n.includes('\\') ||
                            n.startsWith('/') ||
                            n.startsWith('\\')
                        ) {
                            const error = /** @type {any} */ (
                                new Error('ZIP contains unsafe entry paths')
                            );
                            error.code = 'INVALID_MOTION_ZIP';
                            throw error;
                        }
                    }

                    const hasPoster = imageExts.some(ext2 =>
                        entries.some(e =>
                            new RegExp(`(^|/)poster\\.${ext2}$`, 'i').test(e.entryName)
                        )
                    );
                    const hasMotion = videoExts.some(ext2 =>
                        entries.some(e =>
                            new RegExp(`(^|/)motion\\.${ext2}$`, 'i').test(e.entryName)
                        )
                    );

                    if (!hasPoster) {
                        const error = /** @type {any} */ (
                            new Error('Missing required poster.* entry')
                        );
                        error.code = 'INVALID_MOTION_ZIP';
                        throw error;
                    }
                    if (!hasMotion) {
                        const error = /** @type {any} */ (
                            new Error('Missing required motion.* entry')
                        );
                        error.code = 'INVALID_MOTION_ZIP';
                        throw error;
                    }

                    const meta = readZipMetadata(zip);
                    if (!meta) {
                        const error = /** @type {any} */ (
                            new Error('Missing or invalid metadata.json')
                        );
                        error.code = 'INVALID_MOTION_ZIP';
                        throw error;
                    }
                    if (!isMotionZipMetadata(meta)) {
                        const error = /** @type {any} */ (
                            new Error(
                                'metadata.json does not explicitly mark this as a motion posterpack'
                            )
                        );
                        error.code = 'INVALID_MOTION_ZIP';
                        throw error;
                    }
                }

                // Validate normal posterpack ZIPs uploaded into complete/ (stored under complete/*)
                // Intentionally less strict than motion packs: require at least one expected asset entry.
                if (String(targetDir).toLowerCase() === 'complete' && ext === 'zip') {
                    const imageExts = ['jpg', 'jpeg', 'png', 'webp'];
                    const videoExts = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'm4v'];
                    const audioExts = ['mp3', 'flac', 'wav', 'ogg', 'm4a', 'aac'];

                    /** @param {any} zip */
                    const readZipMetadata = zip => {
                        try {
                            const zipEntries = zip.getEntries();
                            const metaEntry = zipEntries.find(e =>
                                /(^|\/)metadata\.json$/i.test(e.entryName)
                            );
                            if (!metaEntry) return null;
                            const content = zip.readAsText(metaEntry);
                            return JSON.parse(content);
                        } catch (_) {
                            return null;
                        }
                    };

                    const zip = new AdmZip(file.path);
                    const entries = zip.getEntries();

                    // Basic safety: disallow traversal/absolute paths inside the ZIP
                    for (const ent of entries) {
                        const n = String(ent.entryName || '');
                        if (
                            n.includes('..') ||
                            n.includes('\\') ||
                            n.startsWith('/') ||
                            n.startsWith('\\')
                        ) {
                            const error = /** @type {any} */ (
                                new Error('ZIP contains unsafe entry paths')
                            );
                            error.code = 'INVALID_POSTERPACK_ZIP';
                            throw error;
                        }
                    }

                    const hasAnyImageAsset = imageExts.some(ext2 =>
                        entries.some(e =>
                            new RegExp(
                                `(^|/)(poster|background|thumb|thumbnail|clearlogo)\\.${ext2}$`,
                                'i'
                            ).test(e.entryName)
                        )
                    );
                    const hasAnyTrailer = videoExts.some(ext2 =>
                        entries.some(e =>
                            new RegExp(`(^|/)trailer\\.${ext2}$`, 'i').test(e.entryName)
                        )
                    );
                    const hasAnyTheme = audioExts.some(ext2 =>
                        entries.some(e =>
                            new RegExp(`(^|/)theme\\.${ext2}$`, 'i').test(e.entryName)
                        )
                    );

                    if (!hasAnyImageAsset && !hasAnyTrailer && !hasAnyTheme) {
                        const error = /** @type {any} */ (
                            new Error(
                                'ZIP does not look like a posterpack (missing poster/background/thumbnail/clearlogo, trailer, or theme)'
                            )
                        );
                        error.code = 'INVALID_POSTERPACK_ZIP';
                        throw error;
                    }

                    // Enforce pack type vs destination folder when uploading into a specific export folder.
                    // This prevents, e.g., game packs being uploaded into plex-export.
                    const completeSubdir = String(req.uploadCompleteSubdir || '').toLowerCase();
                    if (completeSubdir && completeSubdir !== 'manual') {
                        const meta = readZipMetadata(zip);
                        if (!meta || typeof meta !== 'object') {
                            const error = /** @type {any} */ (
                                new Error(
                                    'Missing or invalid metadata.json (required when uploading into an export folder)'
                                )
                            );
                            error.code = 'INVALID_POSTERPACK_ZIP';
                            throw error;
                        }

                        const itemType = String(
                            meta.itemType ||
                                meta.mediaType ||
                                meta.media_kind ||
                                meta.kind ||
                                meta.type ||
                                ''
                        ).toLowerCase();
                        const packType = String(
                            meta.packType || meta.pack || meta.kind || meta.type || ''
                        ).toLowerCase();
                        const isGame =
                            meta.isGame === true ||
                            itemType === 'game' ||
                            packType.includes('game');

                        const expectsGame = completeSubdir === 'romm-export';
                        if (expectsGame && !isGame) {
                            const error = /** @type {any} */ (
                                new Error('This folder only accepts game posterpacks')
                            );
                            error.code = 'INVALID_POSTERPACK_ZIP';
                            throw error;
                        }
                        if (!expectsGame && isGame) {
                            const error = /** @type {any} */ (
                                new Error('Game posterpacks cannot be uploaded into this folder')
                            );
                            error.code = 'INVALID_POSTERPACK_ZIP';
                            throw error;
                        }
                    }
                }

                // Validate uploaded file
                const isValid = await validateUploadedFile(file.path, req.app.locals.config);

                if (!isValid) {
                    // Remove invalid file
                    await fs.remove(file.path);
                    errors.push({
                        originalName: originalName,
                        error: 'File validation failed',
                    });
                    continue;
                }

                // Generate metadata for non-ZIP media only. ZIPs (posterpack uploads) do not get sidecar metadata.
                let metadata = null;
                if (!(targetDir === 'complete' || ext === 'zip')) {
                    metadata = await generateFileMetadata(file, originalName, req);
                    const metadataPath = getMetadataPath(file.path);
                    await fs.outputJson(metadataPath, metadata, { spaces: 2 });
                }

                uploadResults.push({
                    originalName: originalName,
                    savedAs: file.filename,
                    size: file.size,
                    path: file.path,
                    directory: req.uploadTargetDirectory,
                    metadata: metadata,
                });

                logger.info(
                    `FileUpload: Successfully uploaded ${originalName} as ${file.filename}`
                );
            } catch (error) {
                logger.error(`FileUpload: Error processing ${originalName}:`, error);
                errors.push({
                    originalName: originalName,
                    error: error.message,
                });

                // Clean up failed file
                try {
                    await fs.remove(file.path);
                } catch (cleanupError) {
                    logger.error(`FileUpload: Failed to clean up ${file.path}:`, cleanupError);
                }
            }
        }

        // Return results
        const response = {
            // Back-compat: treat partial success as success=false so callers can show errors,
            // while still providing uploadedFiles for the accepted subset.
            success: uploadResults.length > 0 && errors.length === 0,
            filesUploaded: uploadResults.length,
            files: uploadResults,
            uploadedFiles: uploadResults.map(f => ({
                filename: f.savedAs,
                originalName: f.originalName,
                size: f.size,
                path: f.path,
            })),
            totalFiles: req.files.length,
            targetDirectory: req.uploadTargetDirectory,
            targetPath: req.uploadTargetPath,
            completeSubdir: req.uploadCompleteSubdir,
        };

        if (errors.length > 0) {
            response.errors = errors;
            response.message = `${uploadResults.length} of ${req.files.length} files uploaded successfully`;
        }

        // Allow parent route to decide whether to trigger cache refresh.
        res.locals.uploadedCount = uploadResults.length;

        if (uploadResults.length === 0) {
            return res.status(400).json({
                ...response,
                success: false,
                error: 'No valid files uploaded',
            });
        }

        return res.json(response);
    } catch (error) {
        logger.error('FileUpload: Upload completion handler error:', error);
        res.status(500).json({
            success: false,
            error: 'Upload processing failed',
            message: error.message,
        });
    }
}

/**
 * Validate uploaded file
 * @param {string} filePath - Path to uploaded file
 * @param {Object} config - Application configuration
 * @returns {Promise<boolean>} True if file is valid
 */
async function validateUploadedFile(filePath, config) {
    try {
        // Check if file exists and has content
        const stats = await fs.stat(filePath);
        if (stats.size === 0) {
            logger.warn(`FileUpload: Empty file: ${filePath}`);
            return false;
        }

        // File type validation if enabled
        if (config?.localDirectory?.security?.fileTypeValidation) {
            return await validateFileTypeFromHeader(filePath);
        }

        return true;
    } catch (error) {
        logger.error(`FileUpload: File validation error for ${filePath}:`, error);
        return false;
    }
}

/**
 * Validate file type by reading file header
 * @param {string} filePath - Path to file
 * @returns {Promise<boolean>} True if file type is valid
 */
async function validateFileTypeFromHeader(filePath) {
    try {
        // Read first 4KB to detect file type
        const buffer = Buffer.alloc(4096);
        const fd = await fs.open(filePath, 'r');
        const { bytesRead } = await fs.read(fd, buffer, 0, 4096, 0);
        await fs.close(fd);

        if (bytesRead === 0) {
            return false;
        }

        // Detect file type
        const fileType = await FileType.fromBuffer(buffer.slice(0, bytesRead));

        if (!fileType) {
            // Fallback to MIME type detection
            const mimeType = mimeTypes.lookup(filePath);
            return mimeType && (mimeType.startsWith('image/') || mimeType.startsWith('video/'));
        }

        // Check against valid types
        const validTypes = ['jpg', 'png', 'gif', 'webp', 'bmp', 'mp4', 'webm', 'avi', 'zip'];
        return validTypes.includes(fileType.ext);
    } catch (error) {
        logger.error(`FileUpload: File type validation failed for ${filePath}:`, error);
        return false;
    }
}

/**
 * Generate metadata for uploaded file
 * @param {Object} file - Multer file object
 * @param {string} originalName - Original filename
 * @param {Object} req - Express request object (for auth context)
 * @returns {Promise<Object>} Generated metadata
 */
async function generateFileMetadata(file, originalName, req) {
    const nameWithoutExt = path.parse(originalName).name;

    // Try to parse title and year from filename
    const yearMatch = nameWithoutExt.match(/\((\d{4})\)/);
    const title = nameWithoutExt.replace(/\s*\(\d{4}\)\s*$/, '').trim() || nameWithoutExt;
    const year = yearMatch ? parseInt(yearMatch[1]) : null;

    // Generate clean title
    const cleanTitle = generateCleanFilename(nameWithoutExt);

    // Extract username from auth context
    const uploadedBy = req?.session?.username || req?.user?.username || 'admin';

    return {
        originalTitle: nameWithoutExt,
        originalFilename: originalName,
        cleanTitle: cleanTitle,
        title: title,
        year: year,
        genre: [],
        tags: [],
        source: 'user-upload',
        created: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        fileSize: file.size,
        uploadedBy: uploadedBy,
        resolution: null,
        usage: {
            cinema: true,
            wallart: true,
            screensaver: file.destination.includes('backgrounds'),
        },
        statistics: {
            views: 0,
            lastUsed: null,
        },
    };
}

/**
 * Get metadata file path for a media file
 * @param {string} filePath - Path to media file
 * @returns {string} Path to metadata file
 */
function getMetadataPath(filePath) {
    const dir = path.dirname(filePath);
    const basename = path.parse(filePath).name;
    return path.join(dir, `${basename}.poster.json`);
}

/**
 * Error handling middleware for upload errors
 * @param {Error} error - Error object
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} _next - Express next function (unused)
 */
function handleUploadError(error, req, res, _next) {
    logger.error('FileUpload: Upload error:', error);

    const err = /** @type {any} */ (error);
    // Handle specific error types
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
            success: false,
            error: 'File too large',
            message: `Maximum file size exceeded. Limit: ${Math.round(err.limit / 1024 / 1024)}MB`,
        });
    }

    if (err.code === 'LIMIT_FILE_COUNT') {
        return res.status(413).json({
            success: false,
            error: 'Too many files',
            message: `Maximum ${err.limit} files allowed per upload`,
        });
    }

    if (err.code === 'INVALID_FILE_TYPE') {
        return res.status(400).json({
            success: false,
            error: 'Invalid file type',
            message: error.message,
        });
    }

    // Generic error
    res.status(400).json({
        success: false,
        error: 'Upload failed',
        message: error.message,
    });
}

module.exports = {
    createUploadMiddleware,
    handleUploadComplete,
    handleUploadError,
    generateCleanFilename,
    validateFilePath,
};
