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
function forceReloadEnv(rootDir) {
    try {
        const envPath = rootDir ? path.join(rootDir, '.env') : path.resolve(process.cwd(), '.env');
        require('dotenv').config({ path: envPath, override: false });
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
    const copyFileExcl =
        typeof fs.constants?.COPYFILE_EXCL === 'number' ? fs.constants.COPYFILE_EXCL : 0;

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
    try {
        fs.copyFileSync(exampleEnvPath, envPath, copyFileExcl);
        logger.info('[Config] .env created from config.example.env');
    } catch (error) {
        if (error && error.code === 'EEXIST') {
            // Already exists; nothing to do.
        } else if (error && error.code === 'ENOENT') {
            // Source missing or path issues. If .env already exists, we can continue.
            try {
                fs.accessSync(envPath, fs.constants.F_OK);
            } catch {
                console.error('[Config] config.example.env missing, cannot create .env!');
                fatalExit(1);
            }
        } else {
            console.error('[Config] Failed to create .env:', error);
            fatalExit(1);
        }
    }

    // Auto-create config.json if missing
    try {
        fs.copyFileSync(exampleConfigPath, configPath, copyFileExcl);
        logger.info('[Config] config.json created from config.example.json');
    } catch (error) {
        if (error && error.code === 'EEXIST') {
            // Already exists; nothing to do.
        } else if (error && error.code === 'ENOENT') {
            // Source missing or path issues. If config.json already exists, we can continue.
            try {
                fs.accessSync(configPath, fs.constants.F_OK);
            } catch {
                console.error('[Config] config.example.json missing, cannot create config.json!');
                fatalExit(1);
            }
        } else {
            console.error('[Config] Failed to create config.json:', error);
            fatalExit(1);
        }
    }

    // Reload dotenv (always from the app root)
    try {
        const override = process.env.NODE_ENV !== 'test';
        const result = require('dotenv').config({ path: envPath, override });
        /** @type {NodeJS.ErrnoException | undefined} */
        const dotenvErr = result && result.error ? /** @type {any} */ (result.error) : undefined;
        if (dotenvErr && dotenvErr.code !== 'ENOENT') {
            console.error('Error loading .env file:', result.error);
            fatalExit(1);
        }
    } catch (error) {
        console.error('Error loading .env file:', error);
        fatalExit(1);
    }

    // Validate SESSION_SECRET
    if (!process.env.SESSION_SECRET) {
        logger.info('SESSION_SECRET is missing, generating a new one...');
        const newSecret = crypto.randomBytes(32).toString('hex');

        // Set in-process immediately so the app can proceed without blocking on disk IO
        process.env.SESSION_SECRET = newSecret;

        // Persist to .env for future restarts (best-effort, async)
        void fs.promises
            .readFile(envPath, 'utf8')
            .catch(err => {
                if (err && err.code === 'ENOENT') return '';
                throw err;
            })
            .then(envContent => {
                if (/^SESSION_SECRET=/m.test(envContent || '')) return null;
                const suffix = envContent && !envContent.endsWith('\n') ? '\n' : '';
                const updated = `${envContent || ''}${suffix}SESSION_SECRET="${newSecret}"\n`;
                return fs.promises.writeFile(envPath, updated, 'utf8');
            })
            .then(() => {
                logger.info('SESSION_SECRET generated and saved to .env file.');
            })
            .catch(err => {
                logger.warn('Failed to persist SESSION_SECRET to .env file:', err.message);
                logger.warn('⚠️  Continuing with in-memory SESSION_SECRET (not persisted)');
            });
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

const CRITICAL_ASSETS = [
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
    'wallart/artist-cards.js',
    'wallart/film-cards.js',
];

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
    // Generate versions in parallel for all assets
    const versionPromises = CRITICAL_ASSETS.map(async asset => {
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
    // Prime with a stable, immediate fallback without blocking on disk IO.
    // Then refresh actual mtime-based versions asynchronously.
    const fallbackVersion = Math.floor(Date.now() / 1000).toString(36);
    CRITICAL_ASSETS.forEach(asset => {
        cachedVersions[asset] = fallbackVersion;
    });

    lastVersionCheck = Date.now();

    void refreshAssetVersions(rootDir).catch(err => {
        logger.warn('[Asset Versioning] Failed to refresh versions on startup:', err.message);
    });

    logger.debug('Asset versions primed (sync fallback):', CRITICAL_ASSETS.length, 'assets');
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
