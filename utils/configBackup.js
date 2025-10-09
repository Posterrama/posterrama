// Utilities for managing configuration backups (create/list/cleanup/restore) and schedule
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BACKUP_DIR = path.join(ROOT, 'backups', 'config');
const CONFIG_FILE = path.join(ROOT, 'config.json');

// Whitelisted config files at repo root
const FILE_WHITELIST = [
    // Core user configuration
    'config.json',
    'device-presets.json',
    // User data mappings
    'devices.json',
    'groups.json',
    // Secrets and API keys
    '.env',
];

function ensureDirSync(dir) {
    try {
        fs.mkdirSync(dir, { recursive: true });
    } catch (_) {
        /* ignore mkdir error (race condition not critical) */
    }
}

function nowId() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const id = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    return id;
}

async function statIfExists(filePath) {
    try {
        return await fsp.stat(filePath);
    } catch (_) {
        return null;
    }
}

async function createBackup() {
    ensureDirSync(BACKUP_DIR);
    const id = nowId();
    const dir = path.join(BACKUP_DIR, id);
    ensureDirSync(dir);
    const files = [];
    for (const name of FILE_WHITELIST) {
        const src = path.join(ROOT, name);
        const st = await statIfExists(src);
        if (!st || !st.isFile()) continue;
        const dst = path.join(dir, name);
        ensureDirSync(path.dirname(dst));
        await fsp.copyFile(src, dst);
        files.push({ name, size: st.size });
    }
    const meta = { id, createdAt: new Date().toISOString(), files };
    await fsp.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
    return meta;
}

async function listBackups() {
    ensureDirSync(BACKUP_DIR);
    const entries = await fsp.readdir(BACKUP_DIR).catch(() => []);
    const items = [];
    for (const id of entries) {
        const dir = path.join(BACKUP_DIR, id);
        const st = await statIfExists(dir);
        if (!st || !st.isDirectory()) continue;
        let meta = null;
        try {
            const m = await fsp.readFile(path.join(dir, 'meta.json'), 'utf8');
            meta = JSON.parse(m);
        } catch (_) {
            /* ignore malformed/missing meta.json */
        }
        const files = [];
        for (const name of FILE_WHITELIST) {
            const fp = path.join(dir, name);
            const fst = await statIfExists(fp);
            if (fst && fst.isFile()) files.push({ name, size: fst.size });
        }
        items.push({ id, createdAt: meta?.createdAt || new Date(st.mtimeMs).toISOString(), files });
    }
    // Newest first
    items.sort((a, b) => String(b.id).localeCompare(String(a.id)));
    return items;
}

async function cleanupOldBackups(keep = 5) {
    ensureDirSync(BACKUP_DIR);
    const list = await listBackups();
    const toDelete = list.slice(keep);
    let deleted = 0;
    for (const b of toDelete) {
        const dir = path.join(BACKUP_DIR, b.id);
        try {
            await fsp.rm(dir, { recursive: true, force: true });
            deleted++;
        } catch (_) {
            /* ignore delete failure; continue */
        }
    }
    return { deleted, kept: list.length - deleted };
}

async function restoreFile(backupId, fileName) {
    if (!FILE_WHITELIST.includes(fileName)) {
        throw new Error('File not allowed');
    }
    const dir = path.join(BACKUP_DIR, String(backupId));
    const st = await statIfExists(dir);
    if (!st || !st.isDirectory()) throw new Error('Backup not found');
    const src = path.join(dir, fileName);
    const srcSt = await statIfExists(src);
    if (!srcSt || !srcSt.isFile()) throw new Error('File not found in backup');
    const dst = path.join(ROOT, fileName);
    ensureDirSync(path.dirname(dst));
    // Make an implicit safety copy of current file if exists
    const curSt = await statIfExists(dst);
    if (curSt && curSt.isFile()) {
        const safedir = path.join(BACKUP_DIR, `${backupId}-pre-restore`);
        ensureDirSync(safedir);
        try {
            await fsp.copyFile(dst, path.join(safedir, fileName));
        } catch (_) {
            /* ignore safety copy failure */
        }
    }
    await fsp.copyFile(src, dst);
    return { ok: true };
}

async function deleteBackup(backupId) {
    const dir = path.join(BACKUP_DIR, String(backupId));
    const st = await statIfExists(dir);
    if (!st || !st.isDirectory()) throw new Error('Backup not found');
    await fsp.rm(dir, { recursive: true, force: true });
    return { ok: true };
}

async function readScheduleConfig() {
    try {
        const raw = await fsp.readFile(CONFIG_FILE, 'utf8');
        const config = JSON.parse(raw);
        const backups = config.backups || {};
        return {
            enabled: backups.enabled !== false,
            time: backups.time || '02:30',
            retention: Number.isFinite(backups.retention) ? backups.retention : 5,
        };
    } catch (_) {
        return { enabled: true, time: '02:30', retention: 5 };
    }
}

async function writeScheduleConfig(cfg) {
    const backupConfig = {
        enabled: cfg && cfg.enabled !== false,
        time: (cfg && cfg.time) || '02:30',
        retention: Math.max(
            1,
            Math.min(60, Number(cfg && cfg.retention != null ? cfg.retention : 5))
        ),
    };

    // Read current config.json and update backups section
    let config = {};
    try {
        const raw = await fsp.readFile(CONFIG_FILE, 'utf8');
        config = JSON.parse(raw);
    } catch (_) {
        // If config.json doesn't exist or is invalid, create minimal config
    }

    config.backups = backupConfig;
    await fsp.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    return backupConfig;
}

module.exports = {
    FILE_WHITELIST,
    createBackup,
    listBackups,
    cleanupOldBackups,
    restoreFile,
    deleteBackup,
    readScheduleConfig,
    writeScheduleConfig,
};
