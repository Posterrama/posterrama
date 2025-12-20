/**
 * Expand a RomM platform slug into the list of itemIds used by posterpack generation.
 *
 * itemId format: romm_<serverName>_<romId>
 */

async function getRommPlatformItemIds({
    config,
    logger,
    platformId,
    yearFilter = '',
    maxItems = 10000,
    pageSize = 250,
}) {
    const pid = platformId != null ? String(platformId).trim() : '';
    if (!pid) {
        return { itemIds: [], totalFound: 0, capped: false };
    }

    const resolvePlatformId = (() => {
        const cache = new Map();
        const ttlMs = 30 * 60 * 1000;
        return async (client, platformIdOrSlug) => {
            const raw = platformIdOrSlug != null ? String(platformIdOrSlug).trim() : '';
            if (!raw) return null;
            if (/^\d+$/.test(raw)) return raw;
            const key = String(client?.baseUrl || client?.hostname || 'romm');
            const now = Date.now();
            const cached = cache.get(key);
            if (!cached || now - cached.ts > ttlMs) {
                const platforms = await client.getPlatforms();
                const map = new Map();
                if (Array.isArray(platforms)) {
                    for (const p of platforms) {
                        if (!p) continue;
                        if (p.slug && p.id != null) map.set(String(p.slug), String(p.id));
                        if (p.id != null) map.set(String(p.id), String(p.id));
                    }
                }
                cache.set(key, { ts: now, map });
                return map.get(raw) || null;
            }
            return cached.map.get(raw) || null;
        };
    })();

    const mediaServers = Array.isArray(config?.mediaServers) ? config.mediaServers : [];
    const rommServers = mediaServers.filter(s => s && s.type === 'romm' && s.enabled === true);

    if (rommServers.length === 0) {
        return { itemIds: [], totalFound: 0, capped: false };
    }

    const { shuffleArray } = require('./array-utils');
    const RommSource = require('../sources/romm');

    const yearTester = expr => {
        const parts = String(expr || '')
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);
        const ranges = [];
        for (const p of parts) {
            const m1 = p.match(/^\d{4}$/);
            const m2 = p.match(/^(\d{4})\s*-\s*(\d{4})$/);
            if (m1) {
                const y = Number(m1[0]);
                if (y >= 1900) ranges.push([y, y]);
            } else if (m2) {
                const a = Number(m2[1]);
                const b = Number(m2[2]);
                if (a >= 1900 && b >= a) ranges.push([a, b]);
            }
        }
        if (!ranges.length) return null;
        return y => ranges.some(([a, b]) => y >= a && y <= b);
    };

    const yearOk = yearTester(yearFilter);
    const getYearFromRom = rom => {
        const frdRaw = rom?.metadatum?.first_release_date;
        const frd = typeof frdRaw === 'string' ? Number(frdRaw) : frdRaw;
        if (!Number.isFinite(frd) || frd <= 0) return null;
        const ms = frd > 1e11 ? frd : frd * 1000;
        const yr = new Date(ms).getUTCFullYear();
        return Number.isFinite(yr) ? yr : null;
    };

    const itemIds = [];
    let totalFound = 0;
    let capped = false;

    for (const serverConfig of rommServers) {
        const serverName = serverConfig?.name ? String(serverConfig.name) : 'romm';
        try {
            const rommSource = new RommSource(serverConfig, shuffleArray, false);
            const client = await rommSource.getClient();
            const resolvedPid = await resolvePlatformId(client, pid);
            if (!resolvedPid) {
                logger?.warn?.(
                    `[RomM] Unknown platform '${pid}' for server ${serverName}; expected numeric id or known slug.`
                );
                continue;
            }

            let offset = 0;
            const limit = Math.max(1, Math.min(1000, Number(pageSize) || 250));

            // Paginate until we've read total, or until we hit maxItems.
            // RomM API responds with { items, total }.
            // We treat missing total as unknown and stop when the page is empty.
            while (itemIds.length < maxItems) {
                const payload = await client.getRoms({
                    platform_id: resolvedPid,
                    limit,
                    offset,
                });

                const items = Array.isArray(payload?.items)
                    ? payload.items
                    : Array.isArray(payload?.results)
                      ? payload.results
                      : Array.isArray(payload)
                        ? payload
                        : [];

                if (!items.length) break;

                for (const rom of items) {
                    if (itemIds.length >= maxItems) {
                        capped = true;
                        break;
                    }
                    const romId = rom?.id;
                    if (!romId) continue;

                    if (yearOk) {
                        const y = getYearFromRom(rom);
                        if (!Number.isFinite(Number(y)) || !yearOk(Number(y))) continue;
                    }

                    itemIds.push(`romm_${serverName}_${romId}`);
                    totalFound++;
                }

                if (capped) break;

                offset += items.length;
                const total = Number(payload?.total);
                if (Number.isFinite(total) && offset >= total) break;
            }

            if (capped) break;
        } catch (e) {
            try {
                logger?.warn?.(
                    `[RomM] Failed to expand platform ${pid} for server ${serverName}:`,
                    e?.message || e
                );
            } catch (_) {
                /* ignore */
            }
        }
    }

    return { itemIds, totalFound, capped };
}

module.exports = {
    getRommPlatformItemIds,
};
