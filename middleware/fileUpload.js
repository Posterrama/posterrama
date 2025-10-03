const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const mimeTypes = require('mime-types');
const FileType = require('file-type');
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

    // Clean the name part
    const cleanName = nameWithoutExt
        .toLowerCase()
        .replace(/[^a-z0-9\s\-]/g, '') // Remove special chars except spaces and hyphens
        .replace(/\s+/g, '-') // Replace spaces with hyphens
        .replace(/-+/g, '-') // Replace multiple hyphens with single
        .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens

    return cleanName + ext.toLowerCase();
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
    return multer.diskStorage({
        destination: async (req, file, cb) => {
            try {
                // Get target directory from request
                const targetDirectory = req.body.targetDirectory || 'posters';

                // Validate directory name
                const allowedDirectories = ['posters', 'backgrounds', 'motion', 'posterpacks'];
                if (!allowedDirectories.includes(targetDirectory)) {
                    return cb(new Error(`Invalid target directory: ${targetDirectory}`));
                }

                // Construct full path
                const rootPath = config.localDirectory?.rootPath;
                if (!rootPath) {
                    return cb(new Error('Local directory not configured'));
                }

                const fullPath = path.join(rootPath, targetDirectory);

                // Ensure directory exists
                await fs.ensureDir(fullPath);

                // Store target directory in request for later use
                req.uploadTargetDirectory = targetDirectory;
                req.uploadTargetPath = fullPath;

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
    return (req, file, cb) => {
        try {
            // Get supported formats from config
            const supportedFormats = config.localDirectory?.supportedFormats || [
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

            // Extract file extension
            const ext = path.extname(file.originalname).toLowerCase().slice(1);

            // Check if extension is supported
            if (!supportedFormats.includes(ext)) {
                const error = new Error(
                    `File type .${ext} not supported. Supported formats: ${supportedFormats.join(', ')}`
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
    const maxFileSize = config.localDirectory?.maxFileSize || 104857600; // 100MB
    const maxConcurrentUploads = config.localDirectory?.security?.maxConcurrentUploads || 5;

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
 * @param {Function} next - Express next function
 */
async function handleUploadComplete(req, res, next) {
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

            try {
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

                // Generate metadata for the file
                const metadata = await generateFileMetadata(file, originalName);

                // Save metadata
                const metadataPath = getMetadataPath(file.path);
                await fs.outputJson(metadataPath, metadata, { spaces: 2 });

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
            success: uploadResults.length > 0,
            filesUploaded: uploadResults.length,
            files: uploadResults,
            totalFiles: req.files.length,
        };

        if (errors.length > 0) {
            response.errors = errors;
            response.message = `${uploadResults.length} of ${req.files.length} files uploaded successfully`;
        }

        res.json(response);
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
 * @returns {boolean} True if file is valid
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
        if (config.localDirectory?.security?.fileTypeValidation) {
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
 * @returns {boolean} True if file type is valid
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
        const validTypes = ['jpg', 'png', 'gif', 'webp', 'bmp', 'mp4', 'webm', 'avi'];
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
 * @returns {Object} Generated metadata
 */
async function generateFileMetadata(file, originalName) {
    const nameWithoutExt = path.parse(originalName).name;

    // Try to parse title and year from filename
    const yearMatch = nameWithoutExt.match(/\((\d{4})\)/);
    const title = nameWithoutExt.replace(/\s*\(\d{4}\)\s*$/, '').trim() || nameWithoutExt;
    const year = yearMatch ? parseInt(yearMatch[1]) : null;

    // Generate clean title
    const cleanTitle = generateCleanFilename(nameWithoutExt);

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
        uploadedBy: 'admin', // TODO: Get from auth context
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
 * @param {Function} next - Express next function
 */
function handleUploadError(error, req, res, next) {
    logger.error('FileUpload: Upload error:', error);

    // Handle specific error types
    if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
            success: false,
            error: 'File too large',
            message: `Maximum file size exceeded. Limit: ${Math.round(error.limit / 1024 / 1024)}MB`,
        });
    }

    if (error.code === 'LIMIT_FILE_COUNT') {
        return res.status(413).json({
            success: false,
            error: 'Too many files',
            message: `Maximum ${error.limit} files allowed per upload`,
        });
    }

    if (error.code === 'INVALID_FILE_TYPE') {
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
