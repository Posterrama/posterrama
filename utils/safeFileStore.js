/**
 * Safe File Store - Atomic writes with backup and recovery
 *
 * Provides safe JSON file storage with:
 * - Atomic writes (write-then-rename to avoid corruption)
 * - Automatic backup before overwrite
 * - Corruption detection and recovery from backup
 * - Graceful error handling
 *
 * @module utils/safeFileStore
 */

const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');

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
     * Write data to file with atomic operation and optional backup
     *
     * Process:
     * 1. Serialize data to JSON
     * 2. Write to temporary file
     * 3. Create backup of existing file (if enabled)
     * 4. Atomically rename temp file to main file
     *
     * @param {*} data - Data to write (will be JSON.stringify'd)
     * @returns {Promise<void>}
     * @throws {Error} If write operation fails
     *
     * @example
     * await store.write({ device1: { name: 'TV' } });
     */
    async write(data) {
        try {
            // Ensure directory exists
            await fs.mkdir(this.directory, { recursive: true });

            // Serialize data
            const jsonData = JSON.stringify(data, null, this.indent);

            // 1. Write to temporary file first
            await fs.writeFile(this.tempPath, jsonData, 'utf8');

            // 2. Create backup of existing file (if it exists and backup is enabled)
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

            // 3. Atomically rename temp file to main file
            // This is atomic on most filesystems, preventing corruption
            await fs.rename(this.tempPath, this.filePath);

            logger.debug(`[SafeFileStore] Successfully wrote: ${this.filePath}`);
        } catch (error) {
            logger.error(`[SafeFileStore] Error writing ${this.filePath}:`, error.message);

            // Clean up temp file if it exists
            try {
                await fs.unlink(this.tempPath);
            } catch (unlinkError) {
                // Ignore if temp file doesn't exist
            }

            throw error;
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
