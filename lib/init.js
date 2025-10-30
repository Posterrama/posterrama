/**
 * Application Initialization Module
 *
 * Handles startup initialization tasks:
 * - Environment file creation
 * - Config file creation
 * - Required directory creation
 * - SESSION_SECRET generation
 * - Asset version caching
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const logger = require('../utils/logger');

// Test-safe wrapper for fatal exits: suppress actual process termination during Jest
// so a single initialization failure doesn't abort the whole suite. In test mode we
// just log the intent; in other modes we perform a real exit.
function fatalExit(code) {
    if (process.env.NODE_ENV === 'test') {
        try {
            logger.error(`[TestMode] Suppressed process.exit(${code})`);
        } catch (_) {
            /* noop */
        }
        return; // Do not throw; allow tests to continue to inspect state.
    }
    // In non-test environments, exit the process to surface fatal init errors
    process.exit(code);
}

/**
 * Mitigate PM2 env caching issues by re-reading .env on boot (best-effort)
 */
function forceReloadEnv() {
    try {
        require('dotenv').config({ override: false });
    } catch (error) {
        try {
            logger.debug('[Startup] forceReloadEnv skipped:', error.message);
        } catch (_) {
            /* noop */
        }
    }
}

/**
 * Initialize environment files and required directories
 * @param {string} rootDir - Application root directory
 * @returns {object} - Paths to critical directories
 */
function initializeEnvironment(rootDir) {
    const envPath = path.join(rootDir, '.env');
    const exampleEnvPath = path.join(rootDir, 'config.example.env');
    const configPath = path.join(rootDir, 'config.json');
    const exampleConfigPath = path.join(rootDir, 'config.example.json');

    const sessionsPath = path.join(rootDir, 'sessions');
    const imageCacheDir = path.join(rootDir, 'image_cache');
    const cacheDir = path.join(rootDir, 'cache');
    const logsDir = path.join(rootDir, 'logs');
    const avatarDir = path.join(sessionsPath, 'avatars');

    try {
        // Ensure all required directories exist before the application starts.
        // Using sync methods here prevents race conditions with middleware initialization.
        logger.info('Creating required directories...');

        fs.mkdirSync(sessionsPath, { recursive: true });
        fs.mkdirSync(imageCacheDir, { recursive: true });
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.mkdirSync(logsDir, { recursive: true });
        fs.mkdirSync(avatarDir, { recursive: true });

        logger.info(
            '✓ All required directories created/verified: sessions, image_cache, cache, logs'
        );
    } catch (error) {
        console.error('FATAL ERROR: Could not create required directories.', error);
        fatalExit(1);
    }

    // Auto-create .env if missing
    if (!fs.existsSync(envPath)) {
        if (fs.existsSync(exampleEnvPath)) {
            fs.copyFileSync(exampleEnvPath, envPath);
            logger.info('[Config] .env created from config.example.env');
        } else {
            console.error('[Config] config.example.env missing, cannot create .env!');
            fatalExit(1);
        }
    }

    // Auto-create config.json if missing
    if (!fs.existsSync(configPath)) {
        if (fs.existsSync(exampleConfigPath)) {
            fs.copyFileSync(exampleConfigPath, configPath);
            logger.info('[Config] config.json created from config.example.json');
        } else {
            console.error('[Config] config.example.json missing, cannot create config.json!');
            fatalExit(1);
        }
    }

    // Reload dotenv if .env was just created
    try {
        fs.accessSync(envPath);
        require('dotenv').config({ override: true });
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error('Error checking .env file:', error);
            fatalExit(1);
        }
    }

    // Validate SESSION_SECRET
    if (!process.env.SESSION_SECRET) {
        logger.info('SESSION_SECRET is missing, generating a new one...');
        const newSecret = crypto.randomBytes(32).toString('hex');
        // Read the .env file
        const envContent = fs.readFileSync(envPath, 'utf8');
        // Append the new secret to the .env file
        const newEnvContent = envContent + `\nSESSION_SECRET="${newSecret}"\n`;
        // Write the updated content back to the .env file
        fs.writeFileSync(envPath, newEnvContent, 'utf8');
        logger.info('SESSION_SECRET generated and saved to .env file.');
        // Reload environment to pick up the new secret
        require('dotenv').config({ override: true });
    }

    return {
        sessionsPath,
        imageCacheDir,
        cacheDir,
        logsDir,
        avatarDir,
    };
}

/**
 * Asset versioning for cache busting
 */
const cachedVersions = {};
let lastVersionCheck = 0;
const VERSION_CACHE_TTL = 1000; // Cache versions for 1 second

async function generateAssetVersion(rootDir, filePath) {
    try {
        const fullPath = path.join(rootDir, 'public', filePath);
        const stats = await fs.promises.stat(fullPath);
        // Use modification time as version
        return Math.floor(stats.mtime.getTime() / 1000).toString(36);
    } catch (error) {
        // Fallback to current timestamp if file doesn't exist
        return Math.floor(Date.now() / 1000).toString(36);
    }
}

async function refreshAssetVersions(rootDir) {
    const criticalAssets = [
        'core.js',
        'admin.js',
        'style.css',
        'admin.css',
        'cinema/cinema-ui.js',
        'cinema/cinema.css',
        'cinema/cinema-display.js',
        'cinema/cinema-display.css',
        'cinema/cinema-bootstrap.js',
        'preview-cinema.js',
        'preview-cinema.css',
        'logs.js',
        'logs.css',
        'sw.js',
        'client-logger.js',
        'manifest.json',
        'device-mgmt.js',
        'lazy-loading.js',
        'notify.js',
        'screensaver/screensaver.js',
        'screensaver/screensaver.css',
        'wallart/wallart-display.js',
        'wallart/wallart.css',
    ];

    // Generate versions in parallel for all assets
    const versionPromises = criticalAssets.map(async asset => {
        const version = await generateAssetVersion(rootDir, asset);
        return { asset, version };
    });

    const results = await Promise.all(versionPromises);
    results.forEach(({ asset, version }) => {
        cachedVersions[asset] = version;
    });

    lastVersionCheck = Date.now();
    logger.debug('Asset versions refreshed:', cachedVersions);
}

/**
 * Synchronous version of refreshAssetVersions for startup initialization
 */
function refreshAssetVersionsSync(rootDir) {
    const criticalAssets = [
        'core.js',
        'admin.js',
        'style.css',
        'admin.css',
        'cinema/cinema-ui.js',
        'cinema/cinema.css',
        'cinema/cinema-display.js',
        'cinema/cinema-display.css',
        'cinema/cinema-bootstrap.js',
        'preview-cinema.js',
        'preview-cinema.css',
        'logs.js',
        'logs.css',
        'sw.js',
        'client-logger.js',
        'manifest.json',
        'device-mgmt.js',
        'lazy-loading.js',
        'notify.js',
        'screensaver/screensaver.js',
        'screensaver/screensaver.css',
        'wallart/wallart-display.js',
        'wallart/wallart.css',
    ];

    criticalAssets.forEach(asset => {
        try {
            const fullPath = path.join(rootDir, 'public', asset);
            const stats = fs.statSync(fullPath);
            cachedVersions[asset] = Math.floor(stats.mtime.getTime() / 1000).toString(36);
        } catch (err) {
            cachedVersions[asset] = Math.floor(Date.now() / 1000).toString(36);
        }
    });

    lastVersionCheck = Date.now();
    logger.debug('Asset versions refreshed (sync):', Object.keys(cachedVersions).length, 'assets');
}

function getAssetVersions(rootDir) {
    const now = Date.now();
    if (now - lastVersionCheck > VERSION_CACHE_TTL) {
        // Trigger async refresh but return cached versions immediately
        // This prevents blocking the request while maintaining cache freshness
        refreshAssetVersions(rootDir).catch(err => {
            logger.warn('[Asset Versioning] Failed to refresh versions:', err.message);
        });
        lastVersionCheck = now; // Update check time to prevent rapid retries
    }

    return cachedVersions;
}

module.exports = {
    fatalExit,
    forceReloadEnv,
    initializeEnvironment,
    refreshAssetVersions,
    refreshAssetVersionsSync,
    getAssetVersions,
};
