const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

// Max total size for all export logs combined (250 MB)
const MAX_TOTAL_BYTES = 250 * 1024 * 1024;
// Rotate combined log when it grows beyond this size (10 MB)
const COMBINED_ROTATE_BYTES = 10 * 1024 * 1024;

function resolveMediaRoot(config) {
    const root = config?.localDirectory?.rootPath || 'media';
    return path.isAbsolute(root) ? root : path.resolve(path.join(__dirname, '..', root));
}

function getLogsDir(config) {
    const mediaRoot = resolveMediaRoot(config);
    return path.join(mediaRoot, '.posterrama', 'logs');
}

async function ensureDir(dir) {
    await fsp.mkdir(dir, { recursive: true });
}

function ts() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return (
        d.getFullYear() +
        '-' +
        pad(d.getMonth() + 1) +
        '-' +
        pad(d.getDate()) +
        ' ' +
        pad(d.getHours()) +
        ':' +
        pad(d.getMinutes()) +
        ':' +
        pad(d.getSeconds())
    );
}

function tsCompact() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return (
        d.getFullYear().toString() +
        pad(d.getMonth() + 1) +
        pad(d.getDate()) +
        '-' +
        pad(d.getHours()) +
        pad(d.getMinutes()) +
        pad(d.getSeconds())
    );
}

async function rotateIfNeeded(filePath) {
    try {
        const st = await fsp.stat(filePath).catch(() => null);
        if (st && st.size >= COMBINED_ROTATE_BYTES) {
            const dir = path.dirname(filePath);
            const base = path.basename(filePath, path.extname(filePath));
            const ext = path.extname(filePath) || '.log';
            const rotated = path.join(dir, `${base}.${tsCompact()}${ext}`);
            await fsp.rename(filePath, rotated).catch(() => {});
        }
    } catch (_) {
        // ignore
    }
}

async function appendLine(filePath, line) {
    const txt = `[${ts()}] ${line}\n`;
    await fsp.appendFile(filePath, txt).catch(() => {});
}

async function pruneLogsDir(dir, protectedFiles = new Set(), maxTotalBytes = MAX_TOTAL_BYTES) {
    try {
        const entries = await fsp.readdir(dir).catch(() => []);
        const files = [];
        for (const name of entries) {
            const full = path.join(dir, name);
            try {
                const st = await fsp.stat(full);
                if (st.isFile()) files.push({ full, size: st.size, mtimeMs: st.mtimeMs });
            } catch (_) {
                // ignore
            }
        }
        let total = files.reduce((s, f) => s + f.size, 0);
        if (total <= maxTotalBytes) return;
        // Oldest first
        files.sort((a, b) => a.mtimeMs - b.mtimeMs);
        for (const f of files) {
            if (total <= maxTotalBytes) break;
            if (protectedFiles.has(f.full)) continue;
            try {
                await fsp.unlink(f.full);
                total -= f.size;
            } catch (_) {
                // ignore
            }
        }
    } catch (_) {
        // ignore
    }
}

function stringifyMeta(meta) {
    if (!meta) return '';
    try {
        return ' ' + JSON.stringify(meta);
    } catch (_) {
        return ' ' + String(meta);
    }
}

function createExportLogger(config, jobId) {
    const logsDir = getLogsDir(config);
    const combinedPath = path.join(logsDir, 'exports-combined.log');
    const jobFile = path.join(logsDir, `export-${tsCompact()}-${jobId}.log`);

    const protectedFiles = new Set([jobFile]);

    async function write(level, msg, meta) {
        await ensureDir(logsDir);
        // Combined rotation
        await rotateIfNeeded(combinedPath);
        const line = `${level.toUpperCase()} ${msg}${stringifyMeta(meta)}`;
        await appendLine(jobFile, line);
        await appendLine(combinedPath, line);
        // Best-effort prune after each write
        await pruneLogsDir(logsDir, protectedFiles, MAX_TOTAL_BYTES);
    }

    return {
        logsDir,
        jobFile,
        combinedPath,
        info: (msg, meta) => write('info', msg, meta),
        warn: (msg, meta) => write('warn', msg, meta),
        error: (msg, meta) => write('error', msg, meta),
        debug: (msg, meta) => write('debug', msg, meta),
        prune: () => pruneLogsDir(logsDir, protectedFiles, MAX_TOTAL_BYTES),
    };
}

module.exports = {
    createExportLogger,
    getLogsDir,
    resolveMediaRoot,
    pruneLogsDir,
};
