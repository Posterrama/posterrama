const path = require('path');
const crypto = require('crypto');
const SafeFileStore = require('./safeFileStore');

/**
 * Device Profiles Store
 *
 * Manages device profiles - reusable settings bundles that can be assigned to devices.
 * Replaces the previous groups + presets system with a simpler, more powerful model.
 */

// Determine store path with test isolation
let resolvedProfilesPath;
if (process.env.PROFILES_STORE_PATH) {
    resolvedProfilesPath = path.isAbsolute(process.env.PROFILES_STORE_PATH)
        ? process.env.PROFILES_STORE_PATH
        : path.join(__dirname, '..', process.env.PROFILES_STORE_PATH);
} else if (process.env.NODE_ENV === 'test') {
    resolvedProfilesPath = path.join(__dirname, '..', 'profiles.test.json');
} else {
    resolvedProfilesPath = path.join(__dirname, '..', 'profiles.json');
}
const storePath = resolvedProfilesPath;

// Initialize SafeFileStore for atomic writes and backup
const fileStore = new SafeFileStore(storePath, {
    createBackup: true,
    indent: 2,
    useLocking: process.env.NODE_ENV !== 'test',
});

let writeQueue = Promise.resolve();
let cache = null; // in-memory cache of profiles

/**
 * Read all profiles from disk (uses cache if available)
 * @returns {Promise<Array>} Array of profile objects
 */
async function readAll() {
    if (cache) return cache;

    try {
        const data = await fileStore.read();
        cache = data || [];

        if (!Array.isArray(cache)) {
            cache = [];
        }
    } catch (error) {
        cache = [];
    }

    return cache;
}

/**
 * Write all profiles to disk (atomic with backup)
 * @param {Array} profiles - Array of profile objects
 * @returns {Promise<void>}
 */
async function writeAll(profiles) {
    cache = profiles;
    writeQueue = writeQueue.then(async () => {
        await fileStore.write(profiles);
    });
    return writeQueue;
}

/**
 * Get all profiles
 * @returns {Promise<Array>} Array of all profiles
 */
async function getAll() {
    return readAll();
}

/**
 * Get a profile by ID
 * @param {string} id - Profile ID
 * @returns {Promise<Object|null>} Profile object or null
 */
async function getById(id) {
    const all = await readAll();
    return all.find(p => p.id === id) || null;
}

/**
 * Create a new profile
 * @param {Object} data - Profile data
 * @param {string} [data.id] - Optional custom ID (auto-generated if not provided)
 * @param {string} data.name - Profile name (required)
 * @param {string} [data.description] - Profile description
 * @param {Object} [data.settings] - Settings object to apply when profile is active
 * @returns {Promise<Object>} Created profile
 * @throws {Error} If profile with ID already exists
 */
async function createProfile({ id = '', name = '', description = '', settings = {} } = {}) {
    const all = await readAll();
    const now = new Date().toISOString();
    const pid = (id || '').toString().trim() || crypto.randomUUID();

    if (all.some(p => p.id === pid)) {
        throw new Error('profile_exists');
    }

    const profile = {
        id: pid,
        name: name.toString().slice(0, 256),
        description: description.toString().slice(0, 1024),
        settings: settings && typeof settings === 'object' ? settings : {},
        createdAt: now,
        updatedAt: now,
    };

    all.push(profile);
    await writeAll(all);
    return profile;
}

/**
 * Update a profile
 * @param {string} id - Profile ID
 * @param {Object} patch - Fields to update
 * @returns {Promise<Object|null>} Updated profile or null if not found
 */
async function patchProfile(id, patch = {}) {
    const all = await readAll();
    const idx = all.findIndex(p => p.id === id);

    if (idx === -1) return null;

    const now = new Date().toISOString();
    const allowed = ['name', 'description', 'settings'];
    const update = {};

    for (const k of allowed) {
        if (k in patch) update[k] = patch[k];
    }

    // Sanitize settings if provided
    if ('settings' in update) {
        update.settings =
            update.settings && typeof update.settings === 'object'
                ? update.settings
                : all[idx].settings || {};
    }

    all[idx] = { ...all[idx], ...update, updatedAt: now };
    await writeAll(all);
    return all[idx];
}

/**
 * Delete a profile
 * @param {string} id - Profile ID
 * @returns {Promise<boolean>} True if deleted, false if not found
 */
async function deleteProfile(id) {
    const all = await readAll();
    const next = all.filter(p => p.id !== id);

    if (next.length === all.length) return false;

    await writeAll(next);
    return true;
}

/**
 * Reset in-memory cache (for testing)
 */
function resetCache() {
    cache = null;
}

module.exports = {
    storePath,
    getAll,
    getById,
    createProfile,
    patchProfile,
    deleteProfile,
    resetCache,
};
