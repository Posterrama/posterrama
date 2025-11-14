const path = require('path');
const crypto = require('crypto');
const SafeFileStore = require('./safeFileStore');

// Determine store path with test isolation: if NODE_ENV=test and no explicit override, use groups.test.json
let resolvedGroupsPath;
if (process.env.GROUPS_STORE_PATH) {
    resolvedGroupsPath = path.isAbsolute(process.env.GROUPS_STORE_PATH)
        ? process.env.GROUPS_STORE_PATH
        : path.join(__dirname, '..', process.env.GROUPS_STORE_PATH);
} else if (process.env.NODE_ENV === 'test') {
    resolvedGroupsPath = path.join(__dirname, '..', 'groups.test.json');
} else {
    resolvedGroupsPath = path.join(__dirname, '..', 'groups.json');
}
const storePath = resolvedGroupsPath;

// Initialize SafeFileStore for atomic writes and backup
const fileStore = new SafeFileStore(storePath, {
    createBackup: true,
    indent: 2,
});

let writeQueue = Promise.resolve();
let cache = null; // in-memory cache of groups

async function readAll() {
    if (cache) return cache;

    try {
        // SafeFileStore handles corruption detection and backup recovery
        const data = await fileStore.read();
        cache = data || [];

        // Ensure we always return an array, even if the file contains an object
        if (!Array.isArray(cache)) {
            cache = [];
        }
    } catch (error) {
        cache = [];
    }

    return cache;
}

async function writeAll(groups) {
    cache = groups;
    writeQueue = writeQueue.then(async () => {
        // SafeFileStore handles atomic writes, backup, and directory creation
        await fileStore.write(groups);
    });
    return writeQueue;
}

async function getAll() {
    return readAll();
}

async function getById(id) {
    const all = await readAll();
    return all.find(g => g.id === id) || null;
}

async function createGroup({ id, name = '', description = '', settingsTemplate = {}, order } = {}) {
    const all = await readAll();
    const now = new Date().toISOString();
    const gid = (id || '').toString().trim() || crypto.randomUUID();
    if (all.some(g => g.id === gid)) throw new Error('group_exists');
    // Determine order: next available if not provided
    let ord = Number.isFinite(order) ? Number(order) : undefined;
    if (!Number.isFinite(ord)) {
        const maxOrder = all.reduce(
            (m, g) => (Number.isFinite(g.order) ? Math.max(m, g.order) : m),
            -1
        );
        ord = maxOrder + 1;
    }
    const g = {
        id: gid,
        name: name.toString().slice(0, 256),
        description: description.toString().slice(0, 1024),
        settingsTemplate:
            settingsTemplate && typeof settingsTemplate === 'object' ? settingsTemplate : {},
        order: ord,
        createdAt: now,
        updatedAt: now,
    };
    all.push(g);
    await writeAll(all);
    return g;
}

async function patchGroup(id, patch = {}) {
    const all = await readAll();
    const idx = all.findIndex(g => g.id === id);
    if (idx === -1) return null;
    const now = new Date().toISOString();
    const allowed = ['name', 'description', 'settingsTemplate', 'order'];
    const update = {};
    for (const k of allowed) if (k in patch) update[k] = patch[k];
    // Sanitize order if provided
    if ('order' in update) {
        const n = Number(update.order);
        update.order = Number.isFinite(n) ? Math.max(0, Math.min(n, 1e9)) : all[idx].order || 0;
    }
    all[idx] = { ...all[idx], ...update, updatedAt: now };
    await writeAll(all);
    return all[idx];
}

async function deleteGroup(id) {
    const all = await readAll();
    const next = all.filter(g => g.id !== id);
    if (next.length === all.length) return false;
    await writeAll(next);
    return true;
}

// Test helper: reset in-memory cache
function resetCache() {
    cache = null;
}

module.exports = {
    storePath,
    getAll,
    getById,
    createGroup,
    patchGroup,
    deleteGroup,
    resetCache, // Expose for testing
};
