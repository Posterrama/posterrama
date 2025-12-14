/**
 * Optional runtime ownership normalization & privilege drop helper.
 *
 * Activated via environment variables (opt-in, no effect in tests):
 *   POSTERRAMA_AUTO_CHOWN=true          -> attempt to chown listed runtime files/dirs when running as root
 *   POSTERRAMA_RUN_AS_UID=1001          -> numeric uid to assign & optionally drop to
 *   POSTERRAMA_RUN_AS_GID=1001          -> numeric gid to assign & optionally drop to
 *   POSTERRAMA_RUN_AS_USER=posterrama   -> resolve uid/gid from username if numeric not provided
 *   POSTERRAMA_DROP_PRIVS=true          -> after chown, call setgid/setuid to run unprivileged
 *
 * Rationale: In some deployments first start was executed as root (sudo / pm2 root) which creates
 * config.json, devices.json, etc with root ownership. Later runs under an unprivileged
 * user then fail to write or rotate secrets. This helper repairs ownership deterministically during
 * restarts (e.g. PM2 restart) without needing external scripts.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const logger = require('./logger');

function resolveIds() {
    let uid = null;
    let gid = null;
    try {
        if (process.env.POSTERRAMA_RUN_AS_UID) {
            const n = Number(process.env.POSTERRAMA_RUN_AS_UID);
            if (Number.isInteger(n) && n >= 0) uid = n;
        }
        if (process.env.POSTERRAMA_RUN_AS_GID) {
            const n = Number(process.env.POSTERRAMA_RUN_AS_GID);
            if (Number.isInteger(n) && n >= 0) gid = n;
        }
        if ((uid === null || gid === null) && process.env.POSTERRAMA_RUN_AS_USER) {
            const user = process.env.POSTERRAMA_RUN_AS_USER.trim();
            if (user) {
                if (uid === null) {
                    uid = Number(execSync(`id -u ${user}`).toString().trim());
                }
                if (gid === null) {
                    gid = Number(execSync(`id -g ${user}`).toString().trim());
                }
            }
        }
    } catch (e) {
        logger.warn('[Ownership] Failed to resolve target uid/gid:', e.message);
    }
    return { uid, gid };
}

function collectDeviceFiles(baseDir) {
    try {
        return fs
            .readdirSync(baseDir)
            .filter(f => /^devices(\..*)?\.json$/.test(f))
            .map(f => path.join(baseDir, f));
    } catch (_) {
        return [];
    }
}

function ensureList(base) {
    return base.filter(p => !!p);
}

function chownIfNeeded(p, uid, gid, summary) {
    try {
        if (!fs.existsSync(p)) return;
        const st = fs.statSync(p);
        if ((uid !== null && st.uid !== uid) || (gid !== null && st.gid !== gid)) {
            fs.chownSync(p, uid ?? st.uid, gid ?? st.gid);
            summary.changed.push(p);
        } else {
            summary.unchanged.push(p);
        }
    } catch (e) {
        summary.failed.push({ path: p, error: e.message });
    }
}

function fixOwnership(options = {}) {
    if (process.env.NODE_ENV === 'test') return { skipped: true, reason: 'test env' };
    if (!process.getuid || process.getuid() !== 0) {
        return { skipped: true, reason: 'not running as root' };
    }
    if (process.env.POSTERRAMA_AUTO_CHOWN !== 'true') {
        return { skipped: true, reason: 'POSTERRAMA_AUTO_CHOWN!=true' };
    }

    const baseDir = options.baseDir || path.join(__dirname, '..');
    const { uid, gid } = resolveIds();
    if (uid === null && gid === null) {
        return { skipped: true, reason: 'no target uid/gid resolved' };
    }

    const targets = ensureList([
        path.join(baseDir, 'config.json'),
        ...collectDeviceFiles(baseDir),
        path.join(baseDir, 'sessions'),
        path.join(baseDir, 'cache'),
        path.join(baseDir, 'image_cache'),
        path.join(baseDir, 'logs'),
    ]);

    const summary = { changed: [], unchanged: [], failed: [], uid, gid };
    for (const t of targets) chownIfNeeded(t, uid, gid, summary);
    logger.info('[Ownership] normalization summary', summary);

    if (process.env.POSTERRAMA_DROP_PRIVS === 'true') {
        try {
            if (gid !== null && process.getgid && process.getgid() === 0) {
                process.setgid(gid);
            }
            if (uid !== null && process.getuid && process.getuid() === 0) {
                process.setuid(uid);
            }
            logger.info('[Ownership] Dropped privileges', {
                runningUid: process.getuid && process.getuid(),
                runningGid: process.getgid && process.getgid(),
            });
        } catch (e) {
            logger.error('[Ownership] Failed to drop privileges:', e.message);
        }
    }
    return summary;
}

module.exports = { fixOwnership };
