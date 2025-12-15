// Utilities for managing configuration backups (create/list/cleanup/restore) and schedule
const fsp = require('fs').promises;
const path = require('path');
const { auditLog } = require('./auditLogger');

const ROOT = process.env.POSTERRAMA_BACKUP_ROOT
    ? path.resolve(String(process.env.POSTERRAMA_BACKUP_ROOT))
    : path.join(__dirname, '..');
const BACKUP_DIR = path.join(ROOT, 'backups', 'config');
const CONFIG_FILE = path.join(ROOT, 'config.json');

// Whitelisted config files at repo root
const FILE_WHITELIST = [
    // Core user configuration
    'config.json',
    'device-presets.json',
    // User data mappings
    'devices.json',
    // Secrets and API keys
    '.env',
];

async function ensureDir(dir) {
    try {
        await fsp.mkdir(dir, { recursive: true });
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

async function createBackup(options = {}) {
    await ensureDir(BACKUP_DIR);
    const id = nowId();
    const dir = path.join(BACKUP_DIR, id);
    await ensureDir(dir);
    const files = [];
    for (const name of FILE_WHITELIST) {
        const src = path.join(ROOT, name);
        const st = await statIfExists(src);
        if (!st || !st.isFile()) continue;
        const dst = path.join(dir, name);
        await ensureDir(path.dirname(dst));
        await fsp.copyFile(src, dst);
        files.push({ name, size: st.size });
    }
    const meta = {
        id,
        createdAt: new Date().toISOString(),
        files,
        label: options.label ? String(options.label).slice(0, 100) : undefined,
        note: options.note ? String(options.note).slice(0, 500) : undefined,
    };
    // Remove undefined fields for cleaner JSON
    if (meta.label === undefined) delete meta.label;
    if (meta.note === undefined) delete meta.note;
    await fsp.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');

    // Audit log
    auditLog(
        'backup.created',
        {
            backupId: id,
            label: meta.label,
            files: files.length,
            trigger: options.label?.includes('Auto-backup') ? 'auto' : 'manual',
        },
        options.auditContext
    );

    return meta;
}

async function listBackups() {
    await ensureDir(BACKUP_DIR);
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
        // Calculate total size from all files
        const sizeBytes = files.reduce((sum, f) => sum + (f.size || 0), 0);

        const item = {
            id,
            createdAt: meta?.createdAt || new Date(st.mtimeMs).toISOString(),
            sizeBytes,
            files,
        };
        // Include label and note if present (backwards compatible)
        if (meta?.label) item.label = meta.label;
        if (meta?.note) item.note = meta.note;
        items.push(item);
    }
    // Newest first
    items.sort((a, b) => String(b.id).localeCompare(String(a.id)));
    return items;
}

async function cleanupOldBackups(keep = 5, maxAgeDays = 0) {
    await ensureDir(BACKUP_DIR);
    const list = await listBackups();

    // Determine backups to delete based on count and/or age
    const toDelete = [];
    const now = Date.now();
    const maxAgeMs = Number(maxAgeDays) > 0 ? Number(maxAgeDays) * 24 * 60 * 60 * 1000 : 0;

    for (let i = 0; i < list.length; i++) {
        const backup = list[i];
        const shouldDeleteByCount = i >= keep; // Beyond keep threshold

        let shouldDeleteByAge = false;
        if (maxAgeMs > 0) {
            try {
                const createdAt = new Date(backup.createdAt).getTime();
                shouldDeleteByAge = now - createdAt > maxAgeMs;
            } catch (_) {
                /* invalid date; skip age check */
            }
        }

        // Delete if either condition is met
        if (shouldDeleteByCount || shouldDeleteByAge) {
            toDelete.push(backup);
        }
    }

    let deleted = 0;
    for (const b of toDelete) {
        const dir = path.join(BACKUP_DIR, b.id);
        try {
            await fsp.rm(dir, { recursive: true, force: true });
            deleted++;
            auditLog('backup.deleted', { backupId: b.id, reason: 'cleanup' });
        } catch (_) {
            /* ignore delete failure; continue */
        }
    }

    if (deleted > 0) {
        auditLog('backup.cleanup', { deleted, kept: list.length - deleted, keep, maxAgeDays });
    }

    return { deleted, kept: list.length - deleted };
}

async function restoreFile(backupId, fileName, auditContext) {
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
    await ensureDir(path.dirname(dst));
    // Make an implicit safety copy of current file if exists
    const curSt = await statIfExists(dst);
    if (curSt && curSt.isFile()) {
        const safedir = path.join(BACKUP_DIR, `${backupId}-pre-restore`);
        await ensureDir(safedir);
        try {
            await fsp.copyFile(dst, path.join(safedir, fileName));
        } catch (_) {
            /* ignore safety copy failure */
        }
    }
    await fsp.copyFile(src, dst);

    auditLog('backup.restored', { backupId, fileName }, auditContext);

    return { ok: true };
}
async function deleteBackup(backupId, auditContext) {
    const dir = path.join(BACKUP_DIR, String(backupId));
    const st = await statIfExists(dir);
    if (!st || !st.isDirectory()) throw new Error('Backup not found');
    await fsp.rm(dir, { recursive: true, force: true });

    auditLog('backup.deleted', { backupId, reason: 'manual' }, auditContext);

    return { ok: true };
}
async function updateBackupMetadata(backupId, updates = {}) {
    const dir = path.join(BACKUP_DIR, String(backupId));
    const st = await statIfExists(dir);
    if (!st || !st.isDirectory()) throw new Error('Backup not found');

    const metaPath = path.join(dir, 'meta.json');
    let meta = {};
    try {
        const raw = await fsp.readFile(metaPath, 'utf8');
        meta = JSON.parse(raw);
    } catch (_) {
        // If meta.json doesn't exist, create minimal metadata
        meta = {
            id: backupId,
            createdAt: new Date(st.mtimeMs).toISOString(),
            files: [],
            label: '',
            note: '',
        };
    }

    // Update label and note (null/empty removes them)
    if ('label' in updates) {
        if (updates.label && String(updates.label).trim()) {
            meta.label = String(updates.label).slice(0, 100);
        } else {
            delete meta.label;
        }
    }
    if ('note' in updates) {
        if (updates.note && String(updates.note).trim()) {
            meta.note = String(updates.note).slice(0, 500);
        } else {
            delete meta.note;
        }
    }

    await fsp.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');
    return meta;
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
            retentionDays: Number.isFinite(backups.retentionDays) ? backups.retentionDays : 0,
        };
    } catch (_) {
        return { enabled: true, time: '02:30', retention: 5, retentionDays: 0 };
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
        retentionDays: Math.max(
            0,
            Math.min(365, Number(cfg && cfg.retentionDays != null ? cfg.retentionDays : 0))
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
    updateBackupMetadata,
    readScheduleConfig,
    writeScheduleConfig,
};
