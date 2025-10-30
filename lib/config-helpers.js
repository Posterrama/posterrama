/**
 * Configuration and Environment File Helpers
 *
 * Provides utilities for reading/writing config.json and .env files:
 * - readEnvFile() / writeEnvFile() - .env file operations with validation
 * - readConfig() / writeConfig() - config.json operations with atomic writes
 * - restartPM2ForEnvUpdate() - PM2 process restart for env cache clearing
 * - isAdminSetup() - Check if admin credentials are configured
 */

const fs = require('fs');
const fsp = fs.promises;
const logger = require('../utils/logger');

/**
 * Reads the .env file.
 * @returns {Promise<string>} The content of the .env file, or empty string if not found.
 */
async function readEnvFile() {
    try {
        return await fsp.readFile('.env', 'utf-8');
    } catch (error) {
        if (error.code === 'ENOENT') return ''; // File doesn't exist yet
        throw error;
    }
}

/**
 * Writes new values to the .env file while preserving existing content.
 * Creates a backup of the current .env file before making changes.
 * Updates both the file and process.env for immediate effect.
 *
 * @param {Object} newValues - An object with key-value pairs to write.
 * @throws {Error} If file operations fail or if backup creation fails.
 * @example
 * await writeEnvFile({
 *   SERVER_PORT: '4000',
 *   DEBUG: 'true'
 * });
 */
async function writeEnvFile(newValues) {
    // Log environment update attempt
    logger.info('Environment update initiated', {
        action: 'env_update',
        keys: Object.keys(newValues).map(key => {
            // Mask sensitive values in logs
            const isSensitive =
                key.toLowerCase().includes('token') ||
                key.toLowerCase().includes('password') ||
                key.toLowerCase().includes('secret') ||
                key.toLowerCase().includes('apikey');
            return {
                key,
                type: isSensitive ? 'sensitive' : 'regular',
            };
        }),
    });

    try {
        const content = await readEnvFile();
        const lines = content.split('\n');

        // Filter out invalid env values (objects, arrays, null, undefined)
        const validEnvValues = {};
        for (const [key, value] of Object.entries(newValues)) {
            // Only allow strings, numbers, booleans
            if (
                typeof value === 'string' ||
                typeof value === 'number' ||
                typeof value === 'boolean'
            ) {
                validEnvValues[key] = value;
            } else if (value !== null && value !== undefined) {
                logger.warn(
                    `[writeEnvFile] Skipping invalid env value for ${key}: ${typeof value}`,
                    {
                        action: 'env_validation_skip',
                        key,
                        valueType: typeof value,
                    }
                );
            }
        }

        const updatedKeys = new Set(Object.keys(validEnvValues));
        const previousEnv = { ...process.env };

        const newLines = lines
            .map(line => {
                if (line.trim() === '' || line.trim().startsWith('#')) {
                    return line;
                }
                // CRITICAL: Filter out invalid lines without '=' (corrupt/malformed entries)
                if (!line.includes('=')) {
                    logger.warn(
                        `[writeEnvFile] Removing invalid .env line (no '=' found): ${line.substring(0, 50)}...`,
                        {
                            action: 'env_invalid_line_removed',
                            line: line.substring(0, 100),
                        }
                    );
                    return null; // Mark for removal
                }
                const [key] = line.split('=');
                if (updatedKeys.has(key)) {
                    updatedKeys.delete(key);
                    // Don't add quotes - they cause "Invalid character in header" errors
                    return `${key}=${validEnvValues[key]}`;
                }
                return line;
            })
            .filter(line => line !== null); // Remove null entries (invalid lines)

        // Add any new keys that weren't in the file
        updatedKeys.forEach(key => {
            // Don't add quotes - they cause "Invalid character in header" errors
            newLines.push(`${key}=${validEnvValues[key]}`);
        });

        const newContent = newLines.join('\n');

        // Create a backup of the current .env file
        const backupPath = '.env.backup';
        await fsp.writeFile(backupPath, content, 'utf-8');
        logger.debug('Created .env backup file', {
            action: 'env_backup',
            path: backupPath,
        });

        // Write the new content
        await fsp.writeFile('.env', newContent, 'utf-8');

        // Update process.env for the current running instance (only valid values)
        Object.assign(process.env, validEnvValues);

        // Check if DEBUG mode was changed and update logger accordingly
        if ('DEBUG' in validEnvValues) {
            try {
                logger.updateLogLevelFromDebug();
            } catch (error) {
                logger.warn('Failed to update logger level from DEBUG setting', {
                    error: error.message,
                    debugValue: validEnvValues.DEBUG,
                });
            }
        }

        // Log successful environment update with changes
        logger.info('Environment updated successfully', {
            action: 'env_update_success',
            changes: Object.keys(newValues).map(key => {
                const isSensitive =
                    key.toLowerCase().includes('token') ||
                    key.toLowerCase().includes('password') ||
                    key.toLowerCase().includes('secret') ||
                    key.toLowerCase().includes('apikey');
                return {
                    key,
                    type: isSensitive ? 'sensitive' : 'regular',
                    changed: previousEnv[key] !== newValues[key],
                };
            }),
        });
    } catch (error) {
        logger.error('Failed to update environment', {
            action: 'env_update_error',
            error: error.message,
            stack: error.stack,
        });
        throw error;
    }
}

/**
 * Triggers a PM2 process restart to clear environment variable cache.
 * PM2 caches environment variables in dump.pm2, and override:false in forceReloadEnv()
 * means cached values take precedence over .env file. This function ensures a fresh
 * environment load by deleting and restarting the PM2 process.
 *
 * Note: Uses 'pm2 restart' instead of 'pm2 delete && pm2 start' for safety.
 * The downside is that PM2's dump.pm2 cache may still persist. For full environment
 * refresh, manual 'pm2 delete posterrama && pm2 start ecosystem.config.js' is needed.
 *
 * @param {string} reason - Description of why the restart is needed (for logging)
 * @param {boolean} async - If true, returns immediately without waiting for restart
 */
function restartPM2ForEnvUpdate(reason = 'environment update', async = true) {
    if (!process.env.PM2_HOME) {
        logger.debug('[PM2] Not running under PM2, skipping restart');
        return;
    }

    logger.info(`[PM2] Triggering restart to apply environment changes (${reason})`);

    const { exec } = require('child_process');
    const ecosystemConfig = require('../ecosystem.config.js');
    const appName = ecosystemConfig.apps[0].name || 'posterrama';

    // Use 'pm2 restart' instead of 'delete && start' for safety
    // This prevents the app from disappearing if start fails
    const command = `pm2 restart ${appName} --update-env`;

    if (async) {
        // Fire and forget - don't wait for completion
        exec(command, error => {
            if (error) {
                logger.error(`[PM2] Restart failed: ${error.message}`);
            } else {
                logger.info('[PM2] Process restarted with --update-env flag');
            }
        });
    } else {
        // Synchronous execution (blocks until complete)
        try {
            require('child_process').execSync(command);
            logger.info('[PM2] Process restarted with --update-env flag');
        } catch (error) {
            logger.error(`[PM2] Restart failed: ${error.message}`);
        }
    }
}

/**
 * Reads the config.json file.
 * @returns {Promise<Object>} The parsed configuration object.
 */
async function readConfig() {
    const content = await fsp.readFile('./config.json', 'utf-8');
    return JSON.parse(content);
}

/**
 * Writes to the config.json file using a safe, atomic write process.
 * Creates a temporary file and renames it to avoid partial writes.
 * Updates the in-memory config object after successful write.
 *
 * @param {object} newConfig - The new configuration object to write.
 * @param {object} globalConfig - Reference to the global config object to update.
 * @throws {Error} If file operations fail or if JSON serialization fails.
 * @example
 * await writeConfig({
 *   mediaServers: [{
 *     name: 'MainPlex',
 *     type: 'plex',
 *     enabled: true
 *   }],
 *   clockWidget: true
 * }, config);
 */
async function writeConfig(newConfig, globalConfig) {
    // Log configuration change attempt
    logger.info('Configuration update initiated', {
        action: 'config_update',
        changes: Object.keys(newConfig).filter(key => !key.startsWith('_')),
    });

    // Create a deep copy to avoid mutating the original config
    const configCopy = JSON.parse(JSON.stringify(newConfig));

    // Remove metadata before writing
    delete configCopy._metadata;
    const newContent = JSON.stringify(configCopy, null, 2);
    const tempPath = './config.json.tmp';
    const finalPath = './config.json';

    try {
        // Write to a temporary file first
        logger.debug('About to write temp config file', {
            action: 'config_write_start',
            tempPath,
            contentLength: newContent.length,
        });

        await fsp.writeFile(tempPath, newContent, 'utf-8');

        // Log backup creation
        logger.debug('Created temporary config backup', {
            action: 'config_backup',
            tempPath,
        });

        // Atomically rename the temp file to the final file
        logger.debug('About to rename temp file', {
            action: 'config_rename_start',
            tempPath,
            finalPath,
        });

        await fsp.rename(tempPath, finalPath);

        // Update the in-memory config for the current running instance
        const previousConfig = { ...globalConfig };
        Object.assign(globalConfig, newConfig);

        // Log successful configuration change with detailed diff
        logger.info('Configuration updated successfully', {
            action: 'config_update_success',
            changes: Object.keys(newConfig).reduce((acc, key) => {
                if (
                    !key.startsWith('_') &&
                    JSON.stringify(newConfig[key]) !== JSON.stringify(previousConfig[key])
                ) {
                    acc[key] = {
                        previous: previousConfig[key],
                        new: newConfig[key],
                    };
                }
                return acc;
            }, {}),
        });

        // Trigger MQTT state update for all devices (config changes affect all devices)
        if (global.__posterramaMqttBridge) {
            try {
                await global.__posterramaMqttBridge.publishAllDeviceStates();
                logger.debug('MQTT state published after config change');
            } catch (err) {
                logger.warn('Failed to publish MQTT state after config change:', err.message);
            }
        }
    } catch (error) {
        logger.error('Failed to update configuration', {
            action: 'config_update_error',
            error: error.message,
            stack: error.stack,
            code: error.code,
            errno: error.errno,
            syscall: error.syscall,
            path: error.path,
        });

        // Attempt to clean up the temporary file on error
        try {
            await fsp.unlink(tempPath);
            logger.debug('Cleaned up temporary config file after error', {
                action: 'config_cleanup',
                tempPath,
            });
        } catch (cleanupError) {
            logger.warn('Failed to clean up temporary config file', {
                action: 'config_cleanup_error',
                error: cleanupError.message,
            });
        }
        throw error; // Re-throw the original error
    }
}

/**
 * Checks if the admin user has been set up.
 * @returns {boolean} True if admin credentials are configured.
 */
function isAdminSetup() {
    return !!process.env.ADMIN_USERNAME && !!process.env.ADMIN_PASSWORD_HASH;
}

module.exports = {
    readEnvFile,
    writeEnvFile,
    restartPM2ForEnvUpdate,
    readConfig,
    writeConfig,
    isAdminSetup,
};
