const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const AdmZip = require('adm-zip');
const semver = require('semver');
const logger = require('../logger');
const githubService = require('./github');
const fsSync = require('fs');

class AutoUpdater {
    constructor() {
        this.updateInProgress = false;
        this.updateStatus = {
            phase: 'idle',
            progress: 0,
            message: '',
            error: null,
            startTime: null,
            backupPath: null,
        };
        this.appRoot = path.resolve(__dirname, '..');
        // Store backups inside the app directory under ./backups
        this.backupDir = path.resolve(this.appRoot, 'backups');
        this.tempDir = path.resolve(this.appRoot, 'temp');
        this.statusFile = path.resolve(this.appRoot, 'logs', 'updater-status.json');
        this.deferStop = false;
        this.targetUid = null;
        this.targetGid = null;
    }

    async writeStatus() {
        try {
            const fsSync = require('fs');
            const dir = path.dirname(this.statusFile);
            fsSync.mkdirSync(dir, { recursive: true });
            const payload = {
                ...this.updateStatus,
                startTime: this.updateStatus.startTime
                    ? this.updateStatus.startTime.toISOString()
                    : null,
                ts: new Date().toISOString(),
                pid: process.pid,
                version: await fs
                    .readFile(path.join(this.appRoot, 'package.json'), 'utf8')
                    .then(s => JSON.parse(s).version)
                    .catch(() => null),
            };
            await fs.writeFile(this.statusFile, JSON.stringify(payload));
        } catch (e) {
            // best effort; ignore
        }
    }

    /**
     * Get current update status
     */
    getStatus() {
        return { ...this.updateStatus };
    }

    /**
     * Check if update is currently in progress
     */
    isUpdating() {
        return this.updateInProgress;
    }

    /**
     * Start automatic update process
     */
    async startUpdate(targetVersion = null, options = {}) {
        const { dryRun = false, force = false, deferStop = false } = options || {};
        if (this.updateInProgress) {
            throw new Error('Update already in progress');
        }

        this.updateInProgress = true;
        this.updateStatus = {
            phase: 'checking',
            progress: 5,
            message: 'Checking for updates...',
            error: null,
            startTime: new Date(),
            backupPath: null,
        };
        this.deferStop = !!deferStop;
        // Detect desired file ownership before making changes
        await this.detectOwnership();
        await this.writeStatus();

        try {
            logger.info('Starting automatic update process', { targetVersion });

            // Step 1: Check for updates
            const updateInfo = await this.checkForUpdates(targetVersion);
            if (!updateInfo.hasUpdate && !targetVersion && !force) {
                this.updateStatus.phase = 'completed';
                this.updateStatus.progress = 100;
                this.updateStatus.message = 'No updates available';
                this.updateInProgress = false;
                return { success: true, message: 'No updates available' };
            }
            // If force is true, ensure we set latestVersion sensibly for messages
            if (force && !targetVersion) {
                // When forcing without a specific target, use the detected latestVersion
                // so messages and validations refer to it; if checkForUpdates couldn't
                // determine a newer version, treat current version as target.
                if (!updateInfo.latestVersion) {
                    const pkg = JSON.parse(
                        await fs.readFile(path.join(this.appRoot, 'package.json'), 'utf8')
                    );
                    updateInfo.latestVersion = pkg.version;
                }
                updateInfo.hasUpdate = true; // proceed through the pipeline
            }

            // Step 2: Create backup
            this.updateStatus.phase = 'backup';
            this.updateStatus.progress = 15;
            this.updateStatus.message = 'Creating backup...';
            await this.writeStatus();
            let backupPath = null;
            if (dryRun) {
                this.updateStatus.message = 'Creating backup (dry-run, no files copied)';
                await this.writeStatus();
                backupPath = path.join(this.backupDir, 'DRYRUN-NO-BACKUP-CREATED');
            } else {
                const realBackupPath = await this.createBackup();
                backupPath = realBackupPath;
            }
            this.updateStatus.backupPath = backupPath;
            await this.writeStatus();

            // Step 3: Download update
            this.updateStatus.phase = 'download';
            this.updateStatus.progress = 30;
            this.updateStatus.message = `Downloading version ${updateInfo.latestVersion}...`;
            await this.writeStatus();
            const downloadPath = dryRun
                ? path.join(this.tempDir, `dryrun-download-${Date.now()}.zip`)
                : await this.downloadUpdate(updateInfo);

            // Step 4: Validate download
            this.updateStatus.phase = 'validation';
            this.updateStatus.progress = 50;
            this.updateStatus.message = dryRun
                ? 'Validating download (dry-run)'
                : 'Validating download...';
            await this.writeStatus();
            if (!dryRun) {
                await this.validateDownload(downloadPath);
            }

            // Step 5: Stop services
            this.updateStatus.phase = 'stopping';
            this.updateStatus.progress = 60;
            this.updateStatus.message = dryRun
                ? 'Skipping stop services (dry-run)'
                : 'Stopping services...';
            await this.writeStatus();
            if (!dryRun) {
                await this.stopServices();
            }

            // Step 6: Apply update
            this.updateStatus.phase = 'applying';
            this.updateStatus.progress = 75;
            this.updateStatus.message = dryRun
                ? 'Skipping apply update (dry-run)'
                : 'Applying update...';
            await this.writeStatus();
            if (!dryRun) {
                await this.applyUpdate(downloadPath);
            }

            // Step 7: Update dependencies
            this.updateStatus.phase = 'dependencies';
            this.updateStatus.progress = 85;
            this.updateStatus.message = dryRun
                ? 'Skipping dependency update (dry-run)'
                : 'Updating dependencies...';
            await this.writeStatus();
            if (!dryRun) {
                await this.updateDependencies();
            }

            // Step 7.5: Fix ownership if running as root and we detected a non-root owner
            if (!dryRun) {
                await this.fixOwnership();
            }
            // Branch for deferStop to avoid losing final status on PM2 restart
            if (this.deferStop && !dryRun) {
                // Cleanup before restart
                await this.cleanup(downloadPath);

                this.updateStatus.phase = 'restarting';
                this.updateStatus.progress = 99;
                this.updateStatus.message = 'Restarting services via PM2...';
                await this.writeStatus();

                await this.startServices(); // will pm2 restart

                // Mark completed immediately after issuing restart
                this.updateStatus.phase = 'completed';
                this.updateStatus.progress = 100;
                this.updateStatus.message = `Successfully updated to version ${updateInfo.latestVersion}`;
                this.updateInProgress = false;
                await this.writeStatus();
            } else {
                // Step 8: Start services
                this.updateStatus.phase = 'starting';
                this.updateStatus.progress = 95;
                this.updateStatus.message = dryRun
                    ? 'Skipping start services (dry-run)'
                    : 'Starting services...';
                await this.writeStatus();
                if (!dryRun) {
                    await this.startServices();
                }

                // Step 9: Verify update
                this.updateStatus.phase = 'verification';
                this.updateStatus.progress = 98;
                this.updateStatus.message = dryRun
                    ? 'Simulating verification (dry-run)'
                    : 'Verifying update...';
                await this.writeStatus();
                if (!dryRun) {
                    await this.verifyUpdate(updateInfo.latestVersion);
                }

                // Cleanup
                if (!dryRun) {
                    await this.cleanup(downloadPath);
                }

                this.updateStatus.phase = 'completed';
                this.updateStatus.progress = 100;
                this.updateStatus.message = `Successfully updated to version ${updateInfo.latestVersion}`;
                this.updateInProgress = false;
                await this.writeStatus();
            }

            logger.info(
                dryRun ? 'Dry-run update completed successfully' : 'Update completed successfully',
                {
                    version: updateInfo.latestVersion,
                    duration: Date.now() - this.updateStatus.startTime.getTime(),
                    dryRun,
                    deferStop: this.deferStop,
                }
            );

            return {
                success: true,
                message: dryRun
                    ? `Dry-run: simulated update to version ${updateInfo.latestVersion}`
                    : `Successfully updated to version ${updateInfo.latestVersion}`,
                version: updateInfo.latestVersion,
                backupPath,
            };
        } catch (error) {
            logger.error('Update failed', { error: error.message, stack: error.stack });

            this.updateStatus.phase = 'error';
            this.updateStatus.error = error.message;
            this.updateStatus.message = `Update failed: ${error.message}`;
            this.updateInProgress = false;
            await this.writeStatus();

            // Attempt rollback if backup exists (not in dry-run)
            if (!dryRun && this.updateStatus.backupPath) {
                try {
                    await this.rollback();
                    this.updateStatus.message += ' (Rolled back to previous version)';
                } catch (rollbackError) {
                    logger.error('Rollback failed', { error: rollbackError.message });
                    this.updateStatus.message +=
                        ' (Rollback failed - manual intervention required)';
                }
            }

            throw error;
        }
    }

    /**
     * Check for available updates
     */
    async checkForUpdates(targetVersion = null) {
        const packageJson = JSON.parse(
            await fs.readFile(path.join(this.appRoot, 'package.json'), 'utf8')
        );
        const currentVersion = packageJson.version;

        if (targetVersion) {
            // Manual version specification
            return {
                currentVersion,
                latestVersion: targetVersion,
                hasUpdate: semver.gt(targetVersion, currentVersion),
                updateType: semver.diff(currentVersion, targetVersion),
            };
        }

        // Use GitHub service to check for updates
        return await githubService.checkForUpdates(currentVersion);
    }

    /**
     * Create backup of current installation
     */
    async createBackup() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupName = `posterrama-backup-${timestamp}`;
        const backupPath = path.join(this.backupDir, backupName);

        // Ensure backup directory exists
        await fs.mkdir(this.backupDir, { recursive: true });

        logger.info('Creating backup', { backupPath });

        // Copy entire application directory excluding temp files, logs, and backups (to avoid recursion)
        const excludePatterns = [
            'node_modules',
            'temp',
            'logs',
            'backups',
            '.git',
            'image_cache',
            'sessions',
            'coverage',
            'screenshots',
        ];

        await this.copyDirectory(this.appRoot, backupPath, excludePatterns);

        // Create backup manifest
        const manifest = {
            version: JSON.parse(await fs.readFile(path.join(this.appRoot, 'package.json'), 'utf8'))
                .version,
            timestamp: new Date().toISOString(),
            backupPath,
            excludePatterns,
        };

        await fs.writeFile(
            path.join(backupPath, 'backup-manifest.json'),
            JSON.stringify(manifest, null, 2)
        );

        logger.info('Backup created successfully', { backupPath, manifest });

        // Automatically cleanup old backups (keep only 5)
        try {
            const cleanupResult = await this.cleanupOldBackups(5);
            logger.info('Automatic backup cleanup completed', cleanupResult);
        } catch (cleanupError) {
            logger.warn('Automatic backup cleanup failed', { error: cleanupError.message });
            // Don't throw - backup creation is still successful
        }

        return backupPath;
    }

    /**
     * Download update package
     */
    async downloadUpdate(updateInfo) {
        const downloadUrl =
            updateInfo.downloadUrl ||
            `https://github.com/Posterrama/posterrama/archive/refs/tags/v${updateInfo.latestVersion}.zip`;
        const filename = `posterrama-${updateInfo.latestVersion}.zip`;
        const downloadPath = path.join(this.tempDir, filename);

        // Ensure temp directory exists
        await fs.mkdir(this.tempDir, { recursive: true });

        logger.info('Downloading update', { downloadUrl, downloadPath });

        return new Promise((resolve, reject) => {
            const file = require('fs').createWriteStream(downloadPath);
            const request = https.get(
                downloadUrl,
                {
                    headers: {
                        'User-Agent': 'Posterrama-AutoUpdater/1.0',
                    },
                },
                response => {
                    if (response.statusCode === 302 || response.statusCode === 301) {
                        // Handle redirect
                        return https
                            .get(response.headers.location, redirectResponse => {
                                redirectResponse.pipe(file);
                                file.on('finish', () => {
                                    file.close();
                                    resolve(downloadPath);
                                });
                            })
                            .on('error', reject);
                    }

                    if (response.statusCode !== 200) {
                        reject(new Error(`Download failed with status ${response.statusCode}`));
                        return;
                    }

                    response.pipe(file);
                    file.on('finish', () => {
                        file.close();
                        resolve(downloadPath);
                    });
                }
            );

            request.on('error', reject);
            request.setTimeout(60000, () => {
                request.destroy();
                reject(new Error('Download timeout'));
            });
        });
    }

    /**
     * Validate downloaded package
     */
    async validateDownload(downloadPath) {
        logger.info('Validating download', { downloadPath });

        // Check if file exists and has content
        const stats = await fs.stat(downloadPath);
        if (stats.size < 1000) {
            throw new Error('Downloaded file is too small, likely corrupted');
        }

        // Try to extract and validate structure
        try {
            const zip = new AdmZip(downloadPath);
            const entries = zip.getEntries();

            // Check for essential files
            const essentialFiles = ['package.json', 'server.js'];
            const foundFiles = entries.map(entry => entry.entryName);

            for (const file of essentialFiles) {
                const found = foundFiles.some(f => f.endsWith(file));
                if (!found) {
                    throw new Error(`Essential file ${file} not found in update package`);
                }
            }

            logger.info('Download validation successful', {
                fileSize: stats.size,
                entryCount: entries.length,
            });
        } catch (error) {
            throw new Error(`Invalid update package: ${error.message}`);
        }
    }

    /**
     * Stop running services
     */
    async stopServices() {
        logger.info('Stopping services');

        try {
            // If deferStop is enabled, don't stop the PM2 process now to avoid killing the parent
            if (this.deferStop) {
                logger.info(
                    'Defer-stop is enabled; skipping pm2 stop to avoid killing parent process'
                );
            } else {
                // Try to stop PM2 process if running
                await execAsync('pm2 stop posterrama || true');
            }

            // Give it a moment to stop gracefully
            await new Promise(resolve => setTimeout(resolve, 2000));

            logger.info('Services stopped successfully');
        } catch (error) {
            logger.warn('Failed to stop services gracefully', { error: error.message });
            // Continue anyway - we'll restart later
        }
    }

    /**
     * Apply the update
     */
    async applyUpdate(downloadPath) {
        logger.info('Applying update', { downloadPath });

        const extractPath = path.join(this.tempDir, 'extracted');

        // Extract the update
        const zip = new AdmZip(downloadPath);
        zip.extractAllTo(extractPath, true);

        // Find the actual source directory (might be nested in a folder)
        const extracted = await fs.readdir(extractPath);
        let sourceDir = extractPath;

        if (extracted.length === 1) {
            const potentialSource = path.join(extractPath, extracted[0]);
            const stat = await fs.stat(potentialSource);
            if (stat.isDirectory()) {
                sourceDir = potentialSource;
            }
        }

        // Preserve important files/directories
        const preserveItems = ['config.json', '.env', 'image_cache', 'sessions', 'logs', 'cache'];

        const preservedData = {};
        for (const item of preserveItems) {
            const itemPath = path.join(this.appRoot, item);
            try {
                const stats = await fs.stat(itemPath);
                if (stats.isDirectory()) {
                    preservedData[item] = await this.copyDirectoryToMemory(itemPath);
                } else {
                    preservedData[item] = await fs.readFile(itemPath, 'utf8');
                }
            } catch (error) {
                // Item doesn't exist, skip
                logger.debug(`Preserve item ${item} not found, skipping`);
            }
        }

        // Copy new files
        await this.copyDirectory(sourceDir, this.appRoot, ['node_modules']);

        // Restore preserved data
        for (const [item, data] of Object.entries(preservedData)) {
            const itemPath = path.join(this.appRoot, item);
            try {
                if (typeof data === 'string') {
                    await fs.writeFile(itemPath, data);
                } else {
                    await this.restoreDirectoryFromMemory(itemPath, data);
                }
                logger.debug(`Restored preserved item: ${item}`);
            } catch (error) {
                logger.warn(`Failed to restore ${item}`, { error: error.message });
            }
        }

        logger.info('Update applied successfully');
    }

    /**
     * Update dependencies
     */
    async updateDependencies() {
        logger.info('Updating dependencies');

        try {
            const { stderr } = await execAsync('npm install --production', {
                cwd: this.appRoot,
                timeout: 300000, // 5 minutes timeout
            });

            if (stderr && !stderr.includes('WARN')) {
                logger.warn('npm install warnings', { stderr });
            }

            logger.info('Dependencies updated successfully');
        } catch (error) {
            throw new Error(`Failed to update dependencies: ${error.message}`);
        }
    }

    /**
     * Detect desired ownership based on current appRoot owner (before changes)
     */
    async detectOwnership() {
        try {
            const stat = fsSync.statSync(this.appRoot);
            this.targetUid = stat.uid;
            this.targetGid = stat.gid;
            logger.info('Detected target ownership', { uid: this.targetUid, gid: this.targetGid });
        } catch (e) {
            logger.warn('Failed to detect target ownership', { error: e.message });
        }
    }

    /**
     * Recursively fix ownership of app files to match detected user/group
     */
    async fixOwnership() {
        try {
            if (process.getuid && process.getuid() !== 0) {
                // Not root; cannot change ownership
                return;
            }
            if (this.targetUid == null || this.targetGid == null) return;

            // Prefer chown -R for speed
            const cmd = `chown -R ${this.targetUid}:${this.targetGid} .`;
            await execAsync(cmd, { cwd: this.appRoot });
            logger.info('Ownership fixed recursively for app directory', {
                uid: this.targetUid,
                gid: this.targetGid,
            });
        } catch (e) {
            logger.warn('Ownership fix failed', { error: e.message });
        }
    }

    /**
     * Start services
     */
    async startServices() {
        logger.info('Starting services');

        try {
            // When deferStop is enabled, prefer a pm2 restart of the app instead of start
            const cmd = this.deferStop
                ? 'pm2 restart posterrama || pm2 start ecosystem.config.js'
                : 'pm2 start ecosystem.config.js || echo "PM2 not available, manual start required"';
            await execAsync(cmd, { cwd: this.appRoot });

            // Give it a moment to start
            await new Promise(resolve => setTimeout(resolve, 3000));

            logger.info('Services started successfully');
        } catch (error) {
            logger.warn('Failed to start services automatically', { error: error.message });
            // Don't throw - manual restart might be needed
        }
    }

    /**
     * Verify the update was successful
     */
    async verifyUpdate(expectedVersion) {
        logger.info('Verifying update', { expectedVersion });

        try {
            // Check package.json version
            const packageJson = JSON.parse(
                await fs.readFile(path.join(this.appRoot, 'package.json'), 'utf8')
            );

            if (packageJson.version !== expectedVersion) {
                throw new Error(
                    `Version mismatch: expected ${expectedVersion}, got ${packageJson.version}`
                );
            }

            // Try to make a simple HTTP request to verify server is running
            // (This is optional since the server might not be auto-started)

            logger.info('Update verification successful', { version: packageJson.version });
        } catch (error) {
            throw new Error(`Update verification failed: ${error.message}`);
        }
    }

    /**
     * Rollback to previous version
     */
    async rollback() {
        if (!this.updateStatus.backupPath) {
            throw new Error('No backup available for rollback');
        }

        logger.info('Starting rollback', { backupPath: this.updateStatus.backupPath });

        this.updateStatus.phase = 'rollback';
        this.updateStatus.progress = 50;
        this.updateStatus.message = 'Rolling back to previous version...';
        await this.writeStatus();

        try {
            // Stop services
            await this.stopServices();

            // Restore from backup
            await this.copyDirectory(this.updateStatus.backupPath, this.appRoot);

            // Reinstall dependencies
            await this.updateDependencies();

            // Start services
            await this.startServices();

            logger.info('Rollback completed successfully');
            this.updateStatus.message = 'Rollback completed successfully';
        } catch (error) {
            logger.error('Rollback failed', { error: error.message });
            throw new Error(`Rollback failed: ${error.message}`);
        }
    }

    /**
     * Clean up temporary files
     */
    async cleanup(downloadPath = null) {
        logger.info('Cleaning up temporary files');

        try {
            if (downloadPath) {
                await fs.unlink(downloadPath);
            }

            // Clean temp directory
            const tempExists = await fs
                .access(this.tempDir)
                .then(() => true)
                .catch(() => false);
            if (tempExists) {
                if (fs.rm) {
                    await fs.rm(this.tempDir, { recursive: true, force: true });
                } else {
                    // Fallback for very old Node versions
                    await fs.rmdir(this.tempDir, { recursive: true });
                }
            }

            logger.info('Cleanup completed');
        } catch (error) {
            logger.warn('Cleanup failed', { error: error.message });
            // Don't throw - this is not critical
        }
    }

    /**
     * Utility: Copy directory with exclusions
     */
    async copyDirectory(source, destination, exclude = []) {
        await fs.mkdir(destination, { recursive: true });

        const items = await fs.readdir(source);

        for (const item of items) {
            if (exclude.includes(item)) continue;

            const sourcePath = path.join(source, item);
            const destPath = path.join(destination, item);

            const stats = await fs.stat(sourcePath);

            if (stats.isDirectory()) {
                await this.copyDirectory(sourcePath, destPath, exclude);
            } else {
                await fs.copyFile(sourcePath, destPath);
            }
        }
    }

    /**
     * Utility: Copy directory to memory (for preservation)
     */
    async copyDirectoryToMemory(dirPath) {
        const result = {};
        const items = await fs.readdir(dirPath);

        for (const item of items) {
            const itemPath = path.join(dirPath, item);
            const stats = await fs.stat(itemPath);

            if (stats.isDirectory()) {
                result[item] = {
                    type: 'directory',
                    content: await this.copyDirectoryToMemory(itemPath),
                };
            } else {
                result[item] = { type: 'file', content: await fs.readFile(itemPath) };
            }
        }

        return result;
    }

    /**
     * Utility: Restore directory from memory
     */
    async restoreDirectoryFromMemory(dirPath, data) {
        await fs.mkdir(dirPath, { recursive: true });

        for (const [name, item] of Object.entries(data)) {
            const itemPath = path.join(dirPath, name);

            if (item.type === 'directory') {
                await this.restoreDirectoryFromMemory(itemPath, item.content);
            } else {
                await fs.writeFile(itemPath, item.content);
            }
        }
    }

    /**
     * List available backups
     */
    async listBackups() {
        try {
            const backups = [];
            const backupExists = await fs
                .access(this.backupDir)
                .then(() => true)
                .catch(() => false);

            if (!backupExists) {
                return backups;
            }

            const items = await fs.readdir(this.backupDir);

            for (const item of items) {
                const backupPath = path.join(this.backupDir, item);
                const manifestPath = path.join(backupPath, 'backup-manifest.json');

                try {
                    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
                    const stats = await fs.stat(backupPath);

                    backups.push({
                        name: item,
                        path: backupPath,
                        version: manifest.version,
                        timestamp: manifest.timestamp,
                        size: stats.size,
                        created: stats.birthtime,
                    });
                } catch (error) {
                    // Skip invalid backups
                    logger.debug(`Invalid backup ${item}`, { error: error.message });
                }
            }

            return backups.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        } catch (error) {
            logger.error('Failed to list backups', { error: error.message });
            return [];
        }
    }

    /**
     * Delete old backups (keep only the last N backups)
     */
    async cleanupOldBackups(keepCount = 5) {
        try {
            const backups = await this.listBackups();

            if (backups.length <= keepCount) {
                return { deleted: 0, kept: backups.length };
            }

            const toDelete = backups.slice(keepCount);
            let deleted = 0;

            for (const backup of toDelete) {
                try {
                    await fs.rmdir(backup.path, { recursive: true });
                    deleted++;
                    logger.info(`Deleted old backup: ${backup.name}`);
                } catch (error) {
                    logger.warn(`Failed to delete backup ${backup.name}`, { error: error.message });
                }
            }

            return { deleted, kept: backups.length - deleted };
        } catch (error) {
            logger.error('Failed to cleanup old backups', { error: error.message });
            return { deleted: 0, kept: 0 };
        }
    }
}

module.exports = new AutoUpdater();
