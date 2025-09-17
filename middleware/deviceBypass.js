const fs = require('fs');
const path = require('path');
const ipaddr = require('ipaddr.js');
const logger = require('../utils/logger');

/**
 * Parse an IP or CIDR entry. Returns a predicate fn(ip: string)=>boolean.
 * Supports single IPv4/IPv6 addresses or CIDR ranges (e.g. 192.168.0.0/16, 2001:db8::/32).
 */
function buildMatcher(entry) {
    if (!entry || typeof entry !== 'string') return () => false;
    const raw = entry.trim();
    if (!raw) return () => false;
    try {
        if (raw.includes('/')) {
            // CIDR
            const [networkStr, prefixLenStr] = raw.split('/');
            const network = ipaddr.parse(networkStr);
            const kind = network.kind();
            const prefix = parseInt(prefixLenStr, 10);
            if (!Number.isFinite(prefix)) return () => false;
            return ip => {
                try {
                    const addr = ipaddr.parse(ip);
                    if (addr.kind() !== kind) return false;
                    return addr.match(network, prefix);
                } catch (_) {
                    return false;
                }
            };
        }
        // Single IP
        const single = ipaddr.parse(raw);
        return ip => {
            try {
                const addr = ipaddr.parse(ip);
                return (
                    addr.kind() === single.kind() &&
                    addr.toNormalizedString() === single.toNormalizedString()
                );
            } catch (_) {
                return false;
            }
        };
    } catch (e) {
        logger.debug('[DeviceBypass] Invalid entry ignored', { entry: raw, error: e.message });
        return () => false;
    }
}

function loadAllowList() {
    try {
        const cfgPath = path.join(__dirname, '..', 'config.json');
        const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        const list = cfg?.deviceMgmt?.bypass?.ipAllowList;
        if (Array.isArray(list)) return list.filter(x => typeof x === 'string');
    } catch (e) {
        logger.debug('[DeviceBypass] Failed to load config', { error: e.message });
    }
    return [];
}

let matchers = [];
let lastLoad = 0;
const deviceBypassLog = new Map(); // Track logged devices to avoid spam
const RELOAD_INTERVAL_MS = 30_000; // Refresh every 30s to pick up edits

function refreshIfNeeded() {
    const now = Date.now();
    if (now - lastLoad < RELOAD_INTERVAL_MS) return;
    lastLoad = now;
    const allow = loadAllowList();
    const previousCount = matchers.length;
    matchers = allow.map(buildMatcher);

    // Clear device log cache on refresh to re-log devices with new config
    if (previousCount !== matchers.length) {
        deviceBypassLog.clear();
        logger.debug('[DeviceBypass] Whitelist refreshed, device log cache cleared', {
            entries: allow.length,
            previousCount,
            allowList: allow,
        });
    }
}

function extractClientIp(req) {
    // Respect X-Forwarded-For first IP if provided; fall back to req.ip
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length) {
        const first = fwd.split(',')[0].trim();
        if (first) return first;
    }
    return req.ip || (req.connection && req.connection.remoteAddress) || '';
}

function deviceBypassMiddleware(req, _res, next) {
    try {
        refreshIfNeeded();
        const ip = extractClientIp(req);
        const bypass = matchers.some(fn => fn(ip));
        if (bypass) {
            req.deviceBypass = true; // flag for downstream handlers

            // Skip logging for admin pages/API calls to reduce spam
            const isAdminRequest =
                req.url?.includes('/admin') ||
                req.url?.includes('/api/admin') ||
                req.url?.includes('/logs.html') ||
                req.url?.includes('.css') ||
                req.url?.includes('.js') ||
                req.url?.includes('favicon.ico');

            if (!isAdminRequest) {
                // Create unique device identifier for deduplication
                const userAgent = req.headers['user-agent'] || 'Unknown';
                const deviceKey = `${ip}|${userAgent.substring(0, 50)}`;

                // Only log once per device per session (or until server restart)
                if (!deviceBypassLog.has(deviceKey)) {
                    logger.info(
                        `[DeviceBypass] Device whitelisted: ${ip} (${userAgent.substring(0, 50)}) - ${req.method} ${req.url}`,
                        {
                            ip,
                            userAgent: userAgent.substring(0, 100),
                            url: req.url,
                            method: req.method,
                            timestamp: new Date().toISOString(),
                        }
                    );
                    deviceBypassLog.set(deviceKey, Date.now());
                }
            }
        }
    } catch (e) {
        // Non-fatal; continue
    }
    next();
}

module.exports = { deviceBypassMiddleware };
