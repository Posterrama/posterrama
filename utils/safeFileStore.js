/**
 * Safe File Store - Atomic writes with backup and recovery
 *
 * Provides safe JSON file storage with:
 * - Atomic writes (write-then-rename to avoid corruption)
 * - Automatic backup before overwrite
 * - Corruption detection and recovery from backup
 * - File locking to prevent concurrent write conflicts
 * - Graceful error handling
 *
 * @module utils/safeFileStore
 */

const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');
const lockfile = require('proper-lockfile');

/**
 * Safe file store with atomic writes and backup/recovery
 */
class SafeFileStore {
    /**
     * Create a new SafeFileStore
     *
     * @param {string} filePath - Path to the main data file
     * @param {Object} [options={}] - Configuration options
     * @param {string} [options.backupPath] - Custom backup file path (default: filePath + '.backup')
     * @param {string} [options.tempPath] - Custom temp file path (default: filePath + '.tmp')
     * @param {boolean} [options.createBackup=true] - Whether to create backups before write
     * @param {number} [options.indent=4] - JSON indentation spaces
     * @param {boolean} [options.useLocking=true] - Whether to use file locking (default: true)
     * @param {number} [options.lockStale=5000] - Time in ms before lock is considered stale (default: 5000)
     * @param {Object} [options.lockRetries] - Lock retry configuration
     *
     * @example
     * const store = new SafeFileStore('/data/devices.json');
     * await store.write({ device1: { ... } });
     * const data = await store.read();
     */
    constructor(filePath, options = {}) {
        this.filePath = filePath;
        this.backupPath = options.backupPath || `${filePath}.backup`;
        this.tempPath = options.tempPath || `${filePath}.tmp`;
        this.createBackup = options.createBackup !== false;
        this.indent = options.indent !== undefined ? options.indent : 4;
        this.useLocking = options.useLocking !== false;
        this.lockStale = options.lockStale || 5000;
        this.lockRetries = options.lockRetries || {
            retries: 5,
            minTimeout: 100,
            maxTimeout: 1000,
            factor: 2,
        };

        // Ensure directory exists
        this.directory = path.dirname(filePath);
    }

    /**
     * Read data from file with automatic backup recovery on corruption
     *
     * @returns {Promise<*>} Parsed JSON data or null if file doesn't exist
     * @throws {Error} If both main file and backup are corrupted or missing
     *
     * @example
     * const data = await store.read();
     * if (data === null) {
     *   // File doesn't exist yet
     * }
     */
    async read() {
        try {
            const data = await fs.readFile(this.filePath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            // File doesn't exist
            if (error.code === 'ENOENT') {
                logger.debug(`[SafeFileStore] File not found: ${this.filePath}`);
                return null;
            }

            // JSON parse error - try backup
            if (error.name === 'SyntaxError') {
                logger.warn(
                    `[SafeFileStore] Corruption detected in ${this.filePath}, attempting backup recovery`
                );
                return await this._readBackup();
            }

            // Other errors
            logger.error(`[SafeFileStore] Error reading ${this.filePath}:`, error.message);
            throw error;
        }
    }

    /**
     * Read data from backup file
     * @private
     */
    async _readBackup() {
        try {
            const backupData = await fs.readFile(this.backupPath, 'utf8');
            const parsed = JSON.parse(backupData);
            logger.info(`[SafeFileStore] Successfully recovered from backup: ${this.backupPath}`);
            return parsed;
        } catch (backupError) {
            if (backupError.code === 'ENOENT') {
                logger.error(
                    `[SafeFileStore] Backup not found: ${this.backupPath}. Data may be lost.`
                );
                return null;
            }

            if (backupError.name === 'SyntaxError') {
                logger.error(
                    `[SafeFileStore] Backup file also corrupted: ${this.backupPath}. Data may be lost.`
                );
                return null;
            }

            throw backupError;
        }
    }

    /**
     * Write data to file with atomic operation, file locking, and optional backup
     *
     * Process:
     * 1. Acquire file lock to prevent concurrent writes
     * 2. Serialize data to JSON
     * 3. Write to temporary file
     * 4. Create backup of existing file (if enabled)
     * 5. Atomically rename temp file to main file
     * 6. Release lock
     *
     * @param {*} data - Data to write (will be JSON.stringify'd)
     * @returns {Promise<void>}
     * @throws {Error} If write operation fails or lock cannot be acquired
     *
     * @example
     * await store.write({ device1: { name: 'TV' } });
     */
    async write(data) {
        let release = null;
        // Use unique temp file per write to avoid race conditions in concurrent scenarios
        const uniqueTempPath = `${this.tempPath}.${Date.now()}.${Math.random().toString(36).substr(2, 9)}`;

        try {
            // Ensure directory exists
            await fs.mkdir(this.directory, { recursive: true });

            // Ensure main file exists before locking (proper-lockfile requires it)
            try {
                await fs.access(this.filePath);
            } catch (error) {
                if (error.code === 'ENOENT') {
                    await fs.writeFile(this.filePath, '{}', 'utf8');
                    logger.debug(
                        `[SafeFileStore] Created initial file for locking: ${this.filePath}`
                    );
                }
            }

            // 1. Acquire file lock (if enabled)
            if (this.useLocking) {
                try {
                    release = await lockfile.lock(this.filePath, {
                        retries: this.lockRetries,
                        stale: this.lockStale,
                        realpath: false, // Don't resolve symlinks
                    });
                    logger.debug(`[SafeFileStore] Acquired lock: ${this.filePath}`);
                } catch (error) {
                    if (error.code === 'ELOCKED') {
                        const lockError = new Error(
                            `File is locked by another process: ${this.filePath}`
                        );
                        lockError.code = 'ELOCKED';
                        lockError.statusCode = 409;
                        throw lockError;
                    }
                    throw error;
                }
            }

            // 2. Serialize data
            const jsonData = JSON.stringify(data, null, this.indent);

            // 3. Write to unique temporary file first
            await fs.writeFile(uniqueTempPath, jsonData, 'utf8');

            // 4. Create backup of existing file (if it exists and backup is enabled)
            if (this.createBackup) {
                try {
                    await fs.copyFile(this.filePath, this.backupPath);
                    logger.debug(`[SafeFileStore] Created backup: ${this.backupPath}`);
                } catch (error) {
                    // Ignore if main file doesn't exist yet
                    if (error.code !== 'ENOENT') {
                        logger.warn(`[SafeFileStore] Failed to create backup: ${error.message}`);
                    }
                }
            }

            // 5. Atomically rename temp file to main file
            // This is atomic on most filesystems, preventing corruption
            await fs.rename(uniqueTempPath, this.filePath);

            logger.debug(`[SafeFileStore] Successfully wrote: ${this.filePath}`);
        } catch (error) {
            logger.error(`[SafeFileStore] Error writing ${this.filePath}:`, error.message);

            // Clean up unique temp file if it exists
            try {
                await fs.unlink(uniqueTempPath);
            } catch (unlinkError) {
                // Ignore if temp file doesn't exist
            }

            throw error;
        } finally {
            // 6. Always release lock, even on error
            if (release) {
                try {
                    await release();
                    logger.debug(`[SafeFileStore] Released lock: ${this.filePath}`);
                } catch (releaseError) {
                    logger.warn(`[SafeFileStore] Failed to release lock: ${releaseError.message}`);
                }
            }
        }
    }

    /**
     * Check if main file exists
     *
     * @returns {Promise<boolean>} True if file exists
     */
    async exists() {
        try {
            await fs.access(this.filePath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Check if backup file exists
     *
     * @returns {Promise<boolean>} True if backup exists
     */
    async hasBackup() {
        try {
            await fs.access(this.backupPath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Manually restore from backup
     *
     * @returns {Promise<boolean>} True if restore successful, false if no backup
     * @throws {Error} If backup is corrupted
     *
     * @example
     * const restored = await store.restoreFromBackup();
     * if (restored) {
     *   console.log('Data restored from backup');
     * }
     */
    async restoreFromBackup() {
        const hasBackup = await this.hasBackup();
        if (!hasBackup) {
            logger.warn(`[SafeFileStore] No backup available: ${this.backupPath}`);
            return false;
        }

        try {
            // Read and validate backup
            const backupData = await fs.readFile(this.backupPath, 'utf8');
            JSON.parse(backupData); // Validate JSON

            // Copy backup to main file
            await fs.copyFile(this.backupPath, this.filePath);

            logger.info(`[SafeFileStore] Restored from backup: ${this.backupPath}`);
            return true;
        } catch (error) {
            logger.error(`[SafeFileStore] Failed to restore from backup: ${error.message}`);
            throw error;
        }
    }

    /**
     * Delete main file and backup
     *
     * @returns {Promise<void>}
     */
    async delete() {
        const errors = [];

        try {
            await fs.unlink(this.filePath);
            logger.debug(`[SafeFileStore] Deleted: ${this.filePath}`);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                errors.push(error);
            }
        }

        try {
            await fs.unlink(this.backupPath);
            logger.debug(`[SafeFileStore] Deleted backup: ${this.backupPath}`);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                errors.push(error);
            }
        }

        try {
            await fs.unlink(this.tempPath);
            logger.debug(`[SafeFileStore] Deleted temp: ${this.tempPath}`);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                errors.push(error);
            }
        }

        if (errors.length > 0) {
            throw new Error(
                `Failed to delete some files: ${errors.map(e => e.message).join(', ')}`
            );
        }
    }

    /**
     * Get file statistics
     *
     * @returns {Promise<Object>} File stats including size and timestamps
     */
    async getStats() {
        const stats = {
            main: null,
            backup: null,
            temp: null,
        };

        try {
            const mainStats = await fs.stat(this.filePath);
            stats.main = {
                size: mainStats.size,
                modified: mainStats.mtime,
                created: mainStats.birthtime,
            };
        } catch {
            // File doesn't exist
        }

        try {
            const backupStats = await fs.stat(this.backupPath);
            stats.backup = {
                size: backupStats.size,
                modified: backupStats.mtime,
                created: backupStats.birthtime,
            };
        } catch {
            // Backup doesn't exist
        }

        try {
            const tempStats = await fs.stat(this.tempPath);
            stats.temp = {
                size: tempStats.size,
                modified: tempStats.mtime,
                created: tempStats.birthtime,
            };
        } catch {
            // Temp doesn't exist
        }

        return stats;
    }
}

module.exports = SafeFileStore;
