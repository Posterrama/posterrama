const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const logger = require('./logger');

const storePath = process.env.DEVICES_STORE_PATH
    ? path.isAbsolute(process.env.DEVICES_STORE_PATH)
        ? process.env.DEVICES_STORE_PATH
        : path.join(__dirname, '..', process.env.DEVICES_STORE_PATH)
    : path.join(__dirname, '..', 'devices.json');

let writeQueue = Promise.resolve();
let cache = null; // in-memory cache of devices

async function ensureStore() {
    try {
        await fsp.access(storePath);
    } catch (e) {
        await fsp.writeFile(storePath, '[]', 'utf8');
        logger.info(`[Devices] Created store at ${storePath}`);
    }
}

async function readAll() {
    if (cache) return cache;
    await ensureStore();
    const raw = await fsp.readFile(storePath, 'utf8');
    try {
        cache = JSON.parse(raw);
    } catch (e) {
        cache = [];
    }
    return cache;
}

async function writeAll(devices) {
    cache = devices;
    writeQueue = writeQueue.then(async () => {
        const tmp = storePath + '.tmp';
        await fsp.writeFile(tmp, JSON.stringify(devices, null, 2), 'utf8');
        await fsp.rename(tmp, storePath);
    });
    return writeQueue;
}

function hashSecret(secret) {
    return 'sha256:' + crypto.createHash('sha256').update(secret).digest('hex');
}

async function getAll() {
    const all = await readAll();
    return all;
}

async function getById(id) {
    const all = await readAll();
    return all.find(d => d.id === id) || null;
}

async function registerDevice({
    name = '',
    location = '',
    installId = null,
    hardwareId = null,
} = {}) {
    const all = await readAll();
    const now = new Date().toISOString();
    // Prefer existing match by hardwareId (cross-browser on same physical device)
    if (hardwareId) {
        const byHwIdx = all.findIndex(d => d.hardwareId && d.hardwareId === hardwareId);
        if (byHwIdx !== -1) {
            const newSecret = crypto.randomBytes(32).toString('hex');
            all[byHwIdx] = {
                ...all[byHwIdx],
                name: name || all[byHwIdx].name,
                location: location || all[byHwIdx].location,
                secretHash: hashSecret(newSecret),
                updatedAt: now,
                installId: installId || all[byHwIdx].installId || null,
                hardwareId,
            };
            await writeAll(all);
            return { device: all[byHwIdx], secret: newSecret };
        }
    }
    // Fallback: match by installId (same browser profile)
    if (installId) {
        const existingIdx = all.findIndex(d => d.installId && d.installId === installId);
        if (existingIdx !== -1) {
            // Rotate secret for existing device and return existing id
            const newSecret = crypto.randomBytes(32).toString('hex');
            all[existingIdx] = {
                ...all[existingIdx],
                name: name || all[existingIdx].name,
                location: location || all[existingIdx].location,
                secretHash: hashSecret(newSecret),
                updatedAt: now,
                installId,
                hardwareId: hardwareId || all[existingIdx].hardwareId || null,
            };
            await writeAll(all);
            return { device: all[existingIdx], secret: newSecret };
        }
    }

    const id = crypto.randomUUID();
    const secret = crypto.randomBytes(32).toString('hex');
    const device = {
        id,
        installId: installId || null,
        hardwareId: hardwareId || null,
        secretHash: hashSecret(secret),
        name,
        location,
        tags: [],
        groups: [],
        createdAt: now,
        updatedAt: now,
        lastSeenAt: null,
        status: 'unknown',
        clientInfo: {},
        settingsOverride: {},
        currentState: {},
        pairing: {},
    };
    all.push(device);
    await writeAll(all);
    return { device, secret };
}

async function verifyDevice(id, secret) {
    const d = await getById(id);
    if (!d) return false;
    return d.secretHash === hashSecret(secret);
}

async function patchDevice(id, patch) {
    const all = await readAll();
    const idx = all.findIndex(d => d.id === id);
    if (idx === -1) return null;
    const now = new Date().toISOString();
    all[idx] = { ...all[idx], ...patch, updatedAt: now };
    await writeAll(all);
    return all[idx];
}

function genPairCode(len = 6) {
    // Numeric code, easy to read/type
    let s = '';
    for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 10).toString();
    return s;
}

async function generatePairingCode(id, { ttlMs = 10 * 60 * 1000 } = {}) {
    const all = await readAll();
    const idx = all.findIndex(d => d.id === id);
    if (idx === -1) return null;
    const now = Date.now();
    const code = genPairCode(6);
    const expiresAt = new Date(now + ttlMs).toISOString();
    all[idx].pairing = { ...(all[idx].pairing || {}), code, expiresAt };
    all[idx].updatedAt = new Date(now).toISOString();
    await writeAll(all);
    return { code, expiresAt };
}

async function claimByPairingCode({ code, name, location } = {}) {
    if (!code) return null;
    const all = await readAll();
    const now = Date.now();
    const idx = all.findIndex(d => d.pairing && d.pairing.code === code);
    if (idx === -1) return null;
    const exp = Date.parse(all[idx].pairing.expiresAt || 0) || 0;
    if (!exp || exp < now) return null;
    // rotate secret and (optionally) update name/location
    const newSecret = crypto.randomBytes(32).toString('hex');
    all[idx] = {
        ...all[idx],
        secretHash: hashSecret(newSecret),
        name: name || all[idx].name,
        location: location || all[idx].location,
        pairing: { lastPairedAt: new Date(now).toISOString() },
        updatedAt: new Date(now).toISOString(),
    };
    await writeAll(all);
    return { device: all[idx], secret: newSecret };
}

async function updateHeartbeat(id, { clientInfo, currentState, installId, hardwareId } = {}) {
    const all = await readAll();
    const idx = all.findIndex(d => d.id === id);
    if (idx === -1) return null;
    const now = new Date().toISOString();
    all[idx].lastSeenAt = now;
    all[idx].status = 'online';
    // Bind or update installId if provided and different
    if (installId && all[idx].installId !== installId) {
        all[idx].installId = installId;
        // Remove any other devices with the same installId, keep current
        const currentId = all[idx].id;
        const filtered = all.filter((d, i) => i === idx || d.installId !== installId);
        // Rebuild array while preserving current device
        if (filtered.length !== all.length) {
            // Ensure current device present
            const current = all[idx];
            all.length = 0;
            for (const d of filtered) all.push(d);
            // Guarantee current device is in list
            if (!all.find(d => d.id === currentId)) all.push(current);
        }
    }
    // Bind or update hardwareId; prune others sharing same hardwareId
    if (hardwareId && all[idx].hardwareId !== hardwareId) {
        all[idx].hardwareId = hardwareId;
        const currentId = all[idx].id;
        const filtered = all.filter((d, i) => i === idx || d.hardwareId !== hardwareId);
        if (filtered.length !== all.length) {
            const current = all[idx];
            all.length = 0;
            for (const d of filtered) all.push(d);
            if (!all.find(d => d.id === currentId)) all.push(current);
        }
    }
    if (clientInfo) all[idx].clientInfo = { ...all[idx].clientInfo, ...clientInfo };
    if (currentState) all[idx].currentState = { ...all[idx].currentState, ...currentState };
    all[idx].updatedAt = now;
    await writeAll(all);
    return all[idx];
}

async function deleteDevice(id) {
    const all = await readAll();
    const next = all.filter(d => d.id !== id);
    const removed = next.length !== all.length;
    if (removed) {
        await writeAll(next);
        // Clear any queued commands for this device
        try {
            commandQueue.delete(id);
        } catch (_) {}
    }
    return removed;
}

async function findByInstallId(installId) {
    if (!installId) return null;
    const all = await readAll();
    return all.find(d => d.installId === installId) || null;
}

async function findByHardwareId(hardwareId) {
    if (!hardwareId) return null;
    const all = await readAll();
    return all.find(d => d.hardwareId === hardwareId) || null;
}

function screensEqual(a, b) {
    if (!a || !b) return false;
    const aw = Number(a.w || a.width || 0);
    const ah = Number(a.h || a.height || 0);
    const ad = Number(a.dpr || a.scale || 1);
    const bw = Number(b.w || b.width || 0);
    const bh = Number(b.h || b.height || 0);
    const bd = Number(b.dpr || b.scale || 1);
    return aw === bw && ah === bh && ad === bd;
}

// Best-effort duplicate pruning to counter early multi-tab races
async function pruneLikelyDuplicates({
    keepId,
    userAgent,
    screen,
    hardwareId,
    maxDelete = 5,
} = {}) {
    try {
        const all = await readAll();
        const keep = all.find(d => d.id === keepId);
        if (!keep) return { deleted: 0 };
        const kIid = keep.installId || null;
        const kHw = keep.hardwareId || hardwareId || null;
        const keyUA = userAgent || keep.clientInfo?.userAgent || null;
        const keyScreen = screen || keep.clientInfo?.screen || null;

        // Group candidates: same installId (if present) OR same UA+screen and missing installId
        const candidates = all
            .filter(d => d.id !== keepId)
            .filter(d => {
                // Strongest signal: same hardwareId
                if (kHw && d.hardwareId && d.hardwareId === kHw) return true;
                const sameInstall = kIid && d.installId && d.installId === kIid;
                const uaMatch = keyUA && d.clientInfo && d.clientInfo.userAgent === keyUA;
                const scMatch =
                    keyScreen && d.clientInfo && screensEqual(d.clientInfo.screen, keyScreen);
                const missingInstall = kIid && (!d.installId || d.installId === null);
                return sameInstall || (uaMatch && scMatch && (sameInstall || missingInstall));
            });

        if (!candidates.length) return { deleted: 0 };

        // Delete up to maxDelete oldest candidates, keep current keepId
        const sorted = candidates
            .map(d => ({
                d,
                ts: Date.parse(d.updatedAt || d.lastSeenAt || d.createdAt || 0) || 0,
            }))
            .sort((a, b) => a.ts - b.ts);

        const toDelete = sorted
            .slice(0, Math.max(0, Math.min(maxDelete, sorted.length)))
            .map(x => x.d.id);
        let deleted = 0;
        for (const id of toDelete) {
            const ok = await deleteDevice(id);
            if (ok) deleted++;
        }
        return { deleted };
    } catch (e) {
        try {
            logger.warn('[Devices] pruneLikelyDuplicates failed', e);
        } catch (_) {}
        return { deleted: 0 };
    }
}

// In-memory command queue
const commandQueue = new Map(); // id -> [{id,type,payload,ts}]

function queueCommand(id, cmd) {
    const list = commandQueue.get(id) || [];
    const cmdId = crypto.randomUUID();
    const entry = { id: cmdId, ...cmd, ts: Date.now() };
    list.push(entry);
    commandQueue.set(id, list);
    return entry;
}

function popCommands(id) {
    const list = commandQueue.get(id) || [];
    commandQueue.set(id, []);
    return list;
}

module.exports = {
    storePath,
    getAll,
    getById,
    registerDevice,
    verifyDevice,
    patchDevice,
    updateHeartbeat,
    deleteDevice,
    findByInstallId,
    findByHardwareId,
    pruneLikelyDuplicates,
    queueCommand,
    popCommands,
    generatePairingCode,
    claimByPairingCode,
};
