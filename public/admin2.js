/* Admin v2 Dashboard (theme-based) */
/* eslint-disable no-empty */
/* global saveConfigPatch, miniCache, inflight, refreshOverviewLastSync, tvdb */
(function () {
    const $ = (sel, root = document) => root.querySelector(sel);

    // Small utility: debounce
    function debounce(fn, wait = 120) {
        let t;
        return function debounced(...args) {
            const self = this;
            if (t) clearTimeout(t);
            t = setTimeout(() => fn.apply(self, args), wait);
        };
    }

    // Fallback for update polling if not provided by this build
    if (typeof window.pollUpdateStatusOnce !== 'function') {
        window.pollUpdateStatusOnce = async function () {
            return null;
        };
    }

    function setText(id, val) {
        const el = typeof id === 'string' ? document.getElementById(id) : id;
        if (el) el.textContent = val;
    }
    function formatNumber(n) {
        const num = Number(n);
        return Number.isFinite(num) ? num.toLocaleString() : '—';
    }

    // Returns true when the given ISO date falls on the current local day
    /* eslint-disable no-unused-vars */
    function isToday(iso) {
        if (!iso) return false;
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return false;
        const now = new Date();
        return (
            d.getFullYear() === now.getFullYear() &&
            d.getMonth() === now.getMonth() &&
            d.getDate() === now.getDate()
        );
    }
    /* eslint-enable no-unused-vars */

    // Safe fallback meter renderer used by cache/perf panels
    function setMeter(id, pct /* 0-100 */, kind = 'default') {
        const el = typeof id === 'string' ? document.getElementById(id) : id;
        if (!el) return;
        const v = Math.max(0, Math.min(100, Number(pct) || 0));

        // Set width for progress bar
        el.style.width = `${v}%`;

        // Dynamic color based on percentage and kind
        let gradient = '';
        if (kind === 'cpu') {
            if (v < 50) {
                gradient =
                    'linear-gradient(90deg, var(--color-success), var(--color-success-dark))';
            } else if (v < 80) {
                gradient =
                    'linear-gradient(90deg, var(--color-warning), var(--color-warning-dark))';
            } else {
                gradient = 'linear-gradient(90deg, var(--color-error), var(--color-error-dark))';
            }
        } else if (kind === 'mem') {
            if (v < 60) {
                gradient = 'linear-gradient(90deg, var(--color-info), var(--color-info-dark))';
            } else if (v < 85) {
                gradient =
                    'linear-gradient(90deg, var(--color-warning), var(--color-warning-dark))';
            } else {
                gradient = 'linear-gradient(90deg, var(--color-error), var(--color-error-dark))';
            }
        } else {
            // Default gradient
            gradient = 'linear-gradient(90deg, var(--color-info), var(--color-info-dark))';
        }

        el.style.background = gradient;
        el.setAttribute?.('aria-valuenow', String(v));
        if (kind) el.setAttribute?.('data-kind', kind);
    }

    function formatBytes(bytes) {
        if (!bytes && bytes !== 0) return '—';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let i = 0;
        let b = bytes;
        while (b >= 1024 && i < units.length - 1) {
            b /= 1024;
            i++;
        }
        return `${b.toFixed(1)} ${units[i]}`;
    }

    // Simple HTML escaper available at module scope for safe rendering
    function escapeHtml(s) {
        return String(s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // Small helper for JSON fetch with credentials and error propagation
    async function fetchJSON(url, opts = {}) {
        const res = await fetch(url, { credentials: 'include', ...opts });
        const text = await res.text();
        let json = null;
        try {
            json = text ? JSON.parse(text) : null;
        } catch (_) {
            /* ignore parse */
        }
        if (!res.ok) {
            const err = new Error(json?.error || `HTTP ${res.status}`);
            err.status = res.status;
            err.data = json || text;
            throw err;
        }
        return json;
    }

    // Minimal fallbacks so the page can load even if these panels are not needed
    async function refreshDevices() {
        // Fetch devices list and compute counts for Active/Offline tiles
        try {
            const list = await fetchJSON('/api/devices');
            const devices = Array.isArray(list) ? list : [];
            const STALE_OFFLINE_MS = 60 * 60 * 1000; // 1 hour (keep in sync with getStatusClass)
            const isLive = d => {
                try {
                    const raw = String(d.status || '').toLowerCase();
                    // Consider device active if it's live (WS) or reported online by server
                    if (d?.wsConnected) return true;
                    const last = Date.parse(d?.lastSeenAt || 0) || 0;
                    const recent = last && Date.now() - last <= STALE_OFFLINE_MS;
                    return recent && (raw === 'online' || raw === 'live');
                } catch (_) {
                    return false;
                }
            };
            const active = devices.filter(isLive).length;
            const offline = Math.max(0, devices.length - active);
            setText('metric-active-devices', formatNumber(active));
            setText('metric-offline-devices', formatNumber(offline));
            // simple trend/subtext
            const activeTrend = document.getElementById('metric-active-trend');
            if (activeTrend) activeTrend.textContent = active > 0 ? 'live now' : '';
            const offlineSub = document.getElementById('metric-offline-sub');
            if (offlineSub) offlineSub.textContent = offline > 0 ? 'needs attention' : 'all good';
        } catch (e) {
            // Silently ignore to avoid breaking dashboard on unauthenticated sessions
        }
    }

    async function refreshDashboardMetrics() {
        // Populate media totals and Active Mode for the top dashboard cards
        // Apply client-side dedupe and 429 backoff to avoid hammering the server
        if (!window.__metricsCooldownUntil) window.__metricsCooldownUntil = 0;
        if (!window.__metricsInFlight) window.__metricsInFlight = null;
        try {
            const now = Date.now();
            if (now < window.__metricsCooldownUntil) {
                // Respect cooldown after server rate-limited us
                throw new Error('metrics:cooldown');
            }
            if (window.__metricsInFlight) {
                // Share a single in-flight request among callers
                await window.__metricsInFlight;
            }
            const p = (async () => {
                let data = null;
                if (typeof window.dedupJSON === 'function') {
                    const res = await window.dedupJSON('/api/v1/metrics/dashboard');
                    if (res && res.status === 429) {
                        // Exponential backoff-lite: fixed cool-down window
                        window.__metricsCooldownUntil = Date.now() + 30_000; // 30s
                        return null;
                    }
                    data = (res && res.ok && (await res.json())) || null;
                } else {
                    // Fallback
                    data = await fetchJSON('/api/v1/metrics/dashboard').catch(() => null);
                }
                if (data) {
                    const totalMedia =
                        Number(data?.media?.libraryTotals?.total) ||
                        Number(data?.media?.playlistItems) ||
                        0;
                    setText('metric-media-items', formatNumber(totalMedia));
                }
                return data;
            })();
            window.__metricsInFlight = p;
            await p;
        } catch (_) {
            // non-fatal
        } finally {
            window.__metricsInFlight = null;
        }

        // Count enabled sources and update Active Mode from the actual config
        try {
            const configData = await fetchJSON('/api/admin/config').catch(() => null);
            if (configData) {
                const config = configData.config || {};
                let enabledSources = 0;

                // Check each source type
                const mediaServers = config.mediaServers || [];
                const plex = mediaServers.find(s => s.type === 'plex');
                const jf = mediaServers.find(s => s.type === 'jellyfin');

                if (plex?.enabled) enabledSources++;
                if (jf?.enabled) enabledSources++;
                if (config.tmdbSource?.enabled) enabledSources++;
                if (config.tvdbSource?.enabled) enabledSources++;

                const mediaSub = document.getElementById('metric-media-sub');
                if (mediaSub) {
                    if (enabledSources === 0) {
                        mediaSub.textContent = 'no sources configured';
                    } else if (enabledSources === 1) {
                        mediaSub.textContent = 'from 1 source';
                    } else {
                        mediaSub.textContent = `from ${enabledSources} sources`;
                    }
                }

                // Active Mode snapshot: cinema > wallart > screensaver
                try {
                    const c = config;
                    const w = c.wallartMode || {};
                    const active = c.cinemaMode ? 'cinema' : w.enabled ? 'wallart' : 'screensaver';
                    const label =
                        active === 'cinema'
                            ? 'Cinema'
                            : active === 'wallart'
                              ? 'Wallart'
                              : 'Screensaver';
                    setText('metric-mode', label);
                    const sub = (() => {
                        if (active === 'screensaver') {
                            const eff = String(c.transitionEffect || 'kenburns');
                            const interval = Number(c.transitionIntervalSeconds || 0);
                            const clock = c.clockWidget !== false;
                            const effLabel =
                                eff === 'kenburns'
                                    ? 'Ken Burns'
                                    : eff === 'fade'
                                      ? 'Fade'
                                      : eff === 'slide'
                                        ? 'Slide'
                                        : eff;
                            const parts = [];
                            if (interval) parts.push(`Every ${interval}s`);
                            parts.push(`Effect: ${effLabel}`);
                            parts.push(`Clock: ${clock ? 'On' : 'Off'}`);
                            return parts.join(' · ');
                        }
                        if (active === 'wallart') {
                            const density = w.density || 'medium';
                            const rate = Number(w.refreshRate ?? 6);
                            const variant = w.layoutVariant || 'heroGrid';
                            const rateLabel = (() => {
                                const map = [
                                    'Very slow',
                                    'Slow',
                                    'Med‑slow',
                                    'Medium',
                                    'Med‑fast',
                                    'Fast',
                                    'Faster',
                                    'Very fast',
                                    'Ultra',
                                    'Ludicrous',
                                ];
                                return map[Math.min(Math.max(rate, 1), 10) - 1];
                            })();
                            return `${density} · ${rateLabel} · ${variant}`;
                        }
                        // cinema
                        const orient = c.cinemaOrientation || 'auto';
                        return `Orientation: ${orient}`;
                    })();
                    const subEl = document.getElementById('metric-mode-sub');
                    if (subEl) subEl.textContent = sub;
                    // Icon swap
                    const iconEl = document.getElementById('metric-mode-icon');
                    if (iconEl) {
                        iconEl.className = 'fas';
                        if (active === 'screensaver') iconEl.classList.add('fa-image');
                        else if (active === 'wallart') iconEl.classList.add('fa-images');
                        else iconEl.classList.add('fa-tv');
                    }
                } catch (_) {}
            }
        } catch (_) {
            // fallback to static text
            const mediaSub = document.getElementById('metric-media-sub');
            if (mediaSub) mediaSub.textContent = 'from sources';
        }

        // Also refresh devices counts shown on this dashboard row
        await refreshDevices();
    }

    // --- Live Dashboard KPIs ---
    let dashTimer = null;
    let dashLastRun = 0;
    const DASH_MIN_INTERVAL = 10000; // 10s between refreshes (aligned with mini cache TTL)
    function stopDashboardLive() {
        if (dashTimer) {
            clearTimeout(dashTimer);
            dashTimer = null;
        }
    }
    function scheduleNextDashboardTick() {
        stopDashboardLive();
        dashTimer = setTimeout(runDashboardTick, DASH_MIN_INTERVAL);
    }
    async function runDashboardTick() {
        try {
            // Only refresh if dashboard is visible
            const active = document.getElementById('section-dashboard');
            const visible = !!active && active.classList.contains('active') && !active.hidden;
            if (!visible) return;
            const now = Date.now();
            if (now - dashLastRun < DASH_MIN_INTERVAL - 50) return scheduleNextDashboardTick();
            dashLastRun = now;
            await refreshDashboardMetrics();
        } catch (_) {
            /* ignore errors */
        } finally {
            scheduleNextDashboardTick();
        }
    }
    function startDashboardLive() {
        // Avoid duplicate loops
        if (dashTimer) return;
        runDashboardTick();
    }

    // --- Live System Performance ---
    let perfTimer = null;
    const PERF_INTERVAL = 10000; // 10s
    function stopPerfLive() {
        if (perfTimer) {
            clearTimeout(perfTimer);
            perfTimer = null;
        }
    }
    async function runPerfTick() {
        try {
            const active = document.getElementById('section-dashboard');
            const visible = !!active && active.classList.contains('active') && !active.hidden;
            if (!visible) return; // only refresh when dashboard visible
            await refreshPerfDashboard();
        } catch (_) {
            /* ignore */
        } finally {
            perfTimer = setTimeout(runPerfTick, PERF_INTERVAL);
        }
    }
    function startPerfLive() {
        if (perfTimer) return; // avoid duplicates
        // Kick off immediately then schedule
        runPerfTick();
    }

    // Safe shim for external triggers (e.g., SSE) to refresh notifications badge
    try {
        if (!window.refreshAdminBadge) {
            window.refreshAdminBadge = function () {
                try {
                    const fn = (function () {
                        try {
                            // Seek the refreshBadge in closure by referencing the bell button scope
                            return undefined; // placeholder: actual function exists below in initNotifications
                        } catch (_) {
                            return undefined;
                        }
                    })();
                    if (typeof fn === 'function') fn();
                } catch (_) {}
            };
        }
    } catch (_) {}

    async function refreshPerfDashboard() {
        // System status chips and resources
        try {
            const status = await fetchJSON('/api/admin/status');
            const app = String(status?.app?.status || 'unknown');
            const db = String(status?.database?.status || 'unknown');
            const cache = String(status?.cache?.status || 'unknown');

            const map = s => {
                const v = String(s || '').toLowerCase();
                if (v === 'running' || v === 'connected' || v === 'active' || v === 'ok')
                    return 'success';
                if (v === 'warning' || v === 'degraded' || v === 'idle') return 'warning';
                return 'error';
            };
            const appCls = map(app);
            const dbCls = map(db);
            const cacheCls = map(cache);

            const setChip = (dotId, badgeId, cls, textVal) => {
                const dot = document.getElementById(dotId);
                const badge = document.getElementById(badgeId);
                if (dot) {
                    dot.classList.remove('status-success', 'status-warning', 'status-error');
                    dot.classList.add(`status-${cls}`);
                }
                if (badge) {
                    // Don't remove existing status classes for our new pills, just update the text
                    if (!badge.classList.contains('header-pill')) {
                        badge.classList.remove('status-success', 'status-warning', 'status-error');
                        badge.classList.add(`status-${cls}`);
                    }
                    // Update the value span inside the pill
                    const valueSpan = badge.querySelector('.value');
                    if (valueSpan) {
                        let displayText = String(textVal || '');
                        // For storage pill, map to Healthy/Unhealthy wording
                        if (badgeId === 'perf-db-status') {
                            const v = displayText.toLowerCase();
                            const healthyVals = ['connected', 'ok', 'running', 'active'];
                            if (cls === 'success' || healthyVals.includes(v)) {
                                displayText = 'Healthy';
                            } else if (cls === 'warning') {
                                displayText = 'Degraded';
                            } else {
                                displayText = 'Unhealthy';
                            }
                        }
                        valueSpan.textContent = displayText;
                    } else {
                        let displayText = String(textVal || '');
                        if (badgeId === 'perf-db-status') {
                            const v = displayText.toLowerCase();
                            const healthyVals = ['connected', 'ok', 'running', 'active'];
                            if (cls === 'success' || healthyVals.includes(v)) {
                                displayText = 'Healthy';
                            } else if (cls === 'warning') {
                                displayText = 'Degraded';
                            } else {
                                displayText = 'Unhealthy';
                            }
                        }
                        badge.textContent = displayText;
                    }
                }
            };
            setChip('chip-app-dot', 'perf-app-status', appCls, app);
            setChip('chip-db-dot', 'perf-db-status', dbCls, db);
            setChip('chip-cache-dot', 'perf-cache-status', cacheCls, cache);

            // Uptime (prefer numeric seconds → compact format Xd Xh Xm)
            (function () {
                const us = status?.uptimeSeconds;
                const u = status?.uptime;
                let txt = '—';
                if (typeof us === 'number' && Number.isFinite(us)) txt = formatUptime(us);
                else if (typeof u === 'number' && Number.isFinite(u)) txt = formatUptime(u);
                else if (/^\d+$/.test(String(u || ''))) txt = formatUptime(Number(u));
                else if (u) txt = String(u);
                setText('perf-uptime', txt);
            })();
            const memPct = Number(status?.memory?.percent);
            if (Number.isFinite(memPct)) {
                setText(
                    'perf-mem',
                    `${memPct}% (${status?.memory?.usedGB || '—'} GB / ${status?.memory?.totalGB || '—'} GB)`
                );
                setMeter('meter-mem', memPct, 'mem');
            }
            // Simple activity level for end users (Low/Medium/High) — now shown in header pill
            try {
                const cpuPct = Number(
                    status?.cpu?.system ?? status?.cpu?.percent ?? status?.cpu?.usage ?? 0
                );
                const mPct = Number.isFinite(memPct) ? memPct : 0;
                const load = Math.max(0, Math.min(100, Math.round((cpuPct + mPct) / 2)));
                const level = load < 30 ? 'Low' : load < 70 ? 'Medium' : 'High';
                const pill = document.getElementById('perf-activity');
                if (pill) {
                    const valueEl = pill.querySelector('.value');
                    if (valueEl) valueEl.textContent = level;
                    pill.classList.remove('status-success', 'status-warning', 'status-error');
                    if (level === 'Low') pill.classList.add('status-success');
                    else if (level === 'Medium') pill.classList.add('status-warning');
                    else pill.classList.add('status-error');
                    pill.setAttribute(
                        'title',
                        `Overall system activity (CPU and memory): ${level}`
                    );
                }
            } catch (_) {
                /* non-fatal */
            }
        } catch (_) {
            // ignore
        }

        // Detailed performance (CPU, Disk) and show meters
        try {
            const perf = await fetchJSON('/api/admin/performance');
            const cpu = Math.max(
                0,
                Math.min(100, Number(perf?.cpu?.usage ?? perf?.cpu?.percent ?? 0))
            );
            const cpuSys = Math.max(0, Math.min(100, Number(perf?.cpu?.system ?? cpu)));
            const mem = Math.max(0, Math.min(100, Number(perf?.memory?.usage || 0)));
            const diskPct = Math.max(0, Math.min(100, Number(perf?.disk?.usage || 0)));
            // Show only system CPU as requested
            setText('perf-cpu', `${cpuSys}%`);
            setMeter('meter-cpu', cpuSys, 'cpu');
            setText(
                'perf-mem',
                `${mem}% (${perf?.memory?.used || '—'} / ${perf?.memory?.total || '—'})`
            );
            setMeter('meter-mem', mem, 'mem');
            setText(
                'perf-disk',
                `${diskPct}% (${perf?.disk?.used || '—'} / ${perf?.disk?.total || '—'})`
            );
            // Update disk progress bar similar to CPU/Memory
            setMeter('meter-disk', diskPct);
            (function () {
                const us = perf?.uptimeSeconds;
                const u = perf?.uptime;
                let txt = '—';
                if (typeof us === 'number' && Number.isFinite(us)) txt = formatUptime(us);
                else if (typeof u === 'number' && Number.isFinite(u)) txt = formatUptime(u);
                else if (/^\d+$/.test(String(u || ''))) txt = formatUptime(Number(u));
                else if (u) txt = String(u);
                setText('perf-uptime', txt);
            })();

            // Load Average display (1, 5, 15 mins)
            try {
                const laStr = String(perf?.cpu?.loadAverage || '').trim();
                const parts = laStr ? laStr.split(',').map(s => s.trim()) : [];
                const [la1, la5, la15] = [parts[0], parts[1], parts[2]];
                const setChip = (id, val, label) => {
                    const el = document.getElementById(id);
                    if (!el) return;
                    const num = Number(val);
                    const displayVal = Number.isFinite(num) ? String(val) : '—';
                    // include the small label inside the chip
                    el.innerHTML = label
                        ? `<span style="opacity:.8;font-size:.75em;margin-right:6px;">${label}</span><span>${displayVal}</span>`
                        : displayVal;
                    // tooltip for clarity
                    if (label) el.setAttribute('title', `${label} load average: ${val || '—'}`);
                    // simple thresholds: <1 good, 1-2 busy, >2 overloaded
                    el.style.background = '';
                    el.style.color = '';
                    el.style.borderColor = '';
                    if (Number.isFinite(num)) {
                        if (num < 1) {
                            el.style.background = 'rgba(34,197,94,0.15)'; // green
                            el.style.color = '#86efac';
                            el.style.borderColor = 'rgba(34,197,94,0.25)';
                        } else if (num <= 2) {
                            el.style.background = 'rgba(234,179,8,0.15)'; // amber
                            el.style.color = '#fde68a';
                            el.style.borderColor = 'rgba(234,179,8,0.25)';
                        } else {
                            el.style.background = 'rgba(239,68,68,0.15)'; // red
                            el.style.color = '#fca5a5';
                            el.style.borderColor = 'rgba(239,68,68,0.25)';
                        }
                    }
                };
                setChip('perf-loadavg-1', la1, '1m');
                setChip('perf-loadavg-5', la5, '5m');
                setChip('perf-loadavg-15', la15, '15m');
            } catch (_) {
                /* non-fatal */
            }

            // Update tooltip/context for CPU meter to clarify meaning
            try {
                const cpuLabel = document.getElementById('perf-cpu');
                const meter = document.getElementById('meter-cpu');
                const tip = `CPU (system): ${cpuSys}%`;
                if (cpuLabel) cpuLabel.setAttribute('title', tip);
                if (meter) meter.setAttribute('title', tip);
            } catch (_) {
                /* ignore */
            }
        } catch (_) {
            // ignore
        }

        // Traffic & Reliability panel removed
    }

    async function refreshCacheStatsV2() {
        try {
            // Always get fresh stats; also fetch config to derive current maxSizeGB
            const ts = Date.now();
            const [statsRes, cfgRes] = await Promise.all([
                fetch(`/api/admin/cache-stats?_=${ts}`, {
                    credentials: 'include',
                    cache: 'no-store',
                }),
                fetch(`/api/admin/config?_=${ts}`, {
                    credentials: 'include',
                    cache: 'no-store',
                }).catch(() => null),
            ]);
            if (!statsRes.ok) throw new Error(`HTTP ${statsRes.status}`);
            const stats = await statsRes.json();
            let cfg = {};
            try {
                cfg = cfgRes && cfgRes.ok ? await cfgRes.json() : {};
            } catch (_) {
                /* ignore */
            }
            // Prefer value returned by stats.cacheConfig; fall back to config.json
            const fromCfg =
                stats?.cacheConfig?.maxSizeGB ??
                cfg?.config?.cache?.maxSizeGB ??
                cfg?.cache?.maxSizeGB;
            if (fromCfg != null) {
                stats.cacheConfig = stats.cacheConfig || {};
                stats.cacheConfig.maxSizeGB = Number(fromCfg);
            }
            updateCacheStatsDisplayV2(stats);
        } catch (e) {
            console.warn('Cache stats failed', e);
            updateCacheStatsDisplayV2({ diskUsage: { total: 0 }, itemCount: { total: 0 } }, true);
        }
    }

    function updateCacheStatsDisplayV2(data, isError = false) {
        const diskEl = document.getElementById('cache-disk-usage');
        const itemEl = document.getElementById('cache-item-count');
        if (!diskEl || !itemEl) return;
        if (isError) {
            diskEl.innerHTML = '<span class="error">Error loading</span>';
            itemEl.innerHTML = '<span class="error">Error loading</span>';
            return;
        }
        const totalSize = data.diskUsage?.total || 0;
        const imageCacheSize = data.diskUsage?.imageCache || 0;
        const logSize = data.diskUsage?.logFiles || 0;
        // Read server-side cache config if exposed; fallback to 2GB if not available
        const maxSizeGB = Number(
            (data.cacheConfig && data.cacheConfig.maxSizeGB) != null
                ? data.cacheConfig.maxSizeGB
                : 2
        );
        const maxSizeBytes = maxSizeGB * 1024 * 1024 * 1024;
        const usagePct = maxSizeBytes > 0 ? Math.round((imageCacheSize / maxSizeBytes) * 100) : 0;
        diskEl.innerHTML = `
      <div>${formatBytes(imageCacheSize)} / ${formatBytes(maxSizeBytes)} (${usagePct}%)</div>
      <div class="size-bytes">Logs: ${formatBytes(logSize)} | Total: ${formatBytes(totalSize)}</div>
    `;
        const totalItems = data.itemCount?.total || 0;
        itemEl.innerHTML = `
      <div>${Number(totalItems).toLocaleString()}</div>
      <div class="size-bytes">Active in RAM</div>
    `;
        // Update image cache usage meter
        setMeter('meter-image-cache', usagePct, 'mem');
    }

    function wireCacheActions() {
        const cleanupBtn = document.getElementById('cleanup-cache-button');
        const clearBtn = document.getElementById('clear-cache-button');
        const editBtn = document.getElementById('btn-edit-cache-size');
        // Ensure spinner spans exist
        const ensureSpinner = btn => {
            if (!btn) return;
            if (!btn.querySelector('.spinner')) {
                const sp = document.createElement('span');
                sp.className = 'spinner';
                sp.style.display = 'none'; // Hide spinner by default
                btn.insertBefore(sp, btn.firstChild);
            }
        };
        // (moved) TMDB custom dropdown wiring lives near TVDB wiring after iconFor()
        ensureSpinner(cleanupBtn);
        ensureSpinner(clearBtn);
        ensureSpinner(editBtn);
        // Open modal and preload current value
        editBtn?.addEventListener('click', async () => {
            try {
                editBtn.classList.add('btn-loading');
                // Prefer config endpoint for source of truth; fallback to cache-stats if needed
                let maxSizeGB = 2;
                try {
                    const r = await window.dedupJSON('/api/admin/config?_=' + Date.now(), {
                        credentials: 'include',
                    });
                    const j = r?.ok ? await r.json() : null;
                    maxSizeGB = Number(
                        j?.config?.cache?.maxSizeGB ?? j?.cache?.maxSizeGB ?? maxSizeGB
                    );
                } catch (_) {
                    // fallback to cache-stats
                    try {
                        const rs = await window.dedupJSON(
                            '/api/admin/cache-stats?_=' + Date.now(),
                            {
                                credentials: 'include',
                            }
                        );
                        const dj = rs?.ok ? await rs.json() : null;
                        maxSizeGB = Number(dj?.cacheConfig?.maxSizeGB ?? maxSizeGB);
                    } catch (_) {
                        /* ignore */
                    }
                }
                const input = document.getElementById('input-cache-size-gb');
                if (input)
                    input.value = String(
                        Number.isFinite(maxSizeGB) && maxSizeGB > 0 ? maxSizeGB : 2
                    );
                openModal('modal-cache-size');
            } finally {
                editBtn.classList.remove('btn-loading');
            }
        });
        // Save from modal
        const btnSaveSize = document.getElementById('btn-cache-size-save');
        ensureSpinner(btnSaveSize);
        btnSaveSize?.addEventListener('click', async () => {
            const input = document.getElementById('input-cache-size-gb');
            const raw = (input?.value || '').trim();
            const val = Number(raw);
            if (!Number.isFinite(val) || val <= 0) {
                return window.notify?.toast({
                    type: 'warning',
                    title: 'Invalid size',
                    message: 'Enter a number greater than 0 (e.g., 1.5)',
                    duration: 3500,
                });
            }
            if (val > 50) {
                // Hard sanity guard
                const proceed = confirm(
                    'Set cache size above 50GB? This may use significant disk space.'
                );
                if (!proceed) return;
            }
            try {
                btnSaveSize.classList.add('btn-loading');
                // Persist via config patch helper; ensure nested path
                await (typeof saveConfigPatch === 'function'
                    ? saveConfigPatch({ cache: { maxSizeGB: val } })
                    : (async () => {
                          const r = await fetch('/api/admin/config', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              credentials: 'include',
                              body: JSON.stringify({
                                  config: { cache: { maxSizeGB: val } },
                                  env: {},
                              }),
                          });
                          if (!r.ok) throw new Error('Save failed');
                          try {
                              // Manually invalidate cached GET for config and cache-stats in dedup cache if present
                              if (typeof miniCache?.delete === 'function') {
                                  miniCache.delete('/api/admin/config|GET');
                                  miniCache.delete('/api/admin/cache-stats|GET');
                              }
                              if (typeof inflight?.delete === 'function') {
                                  inflight.delete('/api/admin/config|GET');
                                  inflight.delete('/api/admin/cache-stats|GET');
                              }
                          } catch (_) {
                              /* ignore */
                          }
                      })());
                closeModal('modal-cache-size');
                // Optimistically update displayed limit immediately
                try {
                    const diskEl = document.getElementById('cache-disk-usage');
                    if (diskEl) {
                        // Skip brittle inline DOM/Text replacement; a full refresh occurs below
                    }
                } catch (_) {
                    /* ignore */
                }
                window.notify?.toast({
                    type: 'success',
                    title: 'Saved',
                    message: `Cache size set to ${val} GB`,
                    duration: 3000,
                });
                // Refresh displayed stats and meter
                await refreshCacheStatsV2();
            } catch (e) {
                window.notify?.toast({
                    type: 'error',
                    title: 'Save failed',
                    message: e?.message || 'Unable to save cache size',
                    duration: 5000,
                });
            } finally {
                btnSaveSize.classList.remove('btn-loading');
            }
        });
        cleanupBtn?.addEventListener('click', async () => {
            try {
                // Persistent progress toast
                const t = window.notify?.toast({
                    type: 'info',
                    title: 'Cleaning up…',
                    message: 'Removing old cache files…',
                    duration: 0,
                });
                cleanupBtn.disabled = true;
                cleanupBtn.setAttribute('aria-busy', 'true');
                cleanupBtn.classList.add('btn-loading');
                const res = await fetch('/api/admin/cleanup-cache', {
                    method: 'POST',
                    credentials: 'include',
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data?.error || 'Failed to cleanup cache');
                t?.dismiss && t.dismiss();
                const detail = [];
                if (typeof data?.filesRemoved === 'number')
                    detail.push(`${data.filesRemoved} files removed`);
                if (data?.spaceSaved) detail.push(`saved ${data.spaceSaved}`);
                window.notify?.toast({
                    type: 'success',
                    title: 'Cleanup complete',
                    message: detail.join(' • ') || 'Cache cleanup finished',
                    duration: 3500,
                });
            } catch (e) {
                console.warn('Cleanup cache failed', e);
                window.notify?.toast({
                    type: 'error',
                    title: 'Cleanup failed',
                    message: e?.message || 'Unable to cleanup cache',
                    duration: 5000,
                });
            } finally {
                cleanupBtn.disabled = false;
                cleanupBtn.removeAttribute('aria-busy');
                cleanupBtn.classList.remove('btn-loading');
                refreshCacheStatsV2();
            }
        });
        clearBtn?.addEventListener('click', async () => {
            const confirmOnce = clearBtn.getAttribute('data-confirm') === '1';
            if (!confirmOnce) {
                clearBtn.setAttribute('data-confirm', '1');
                const label = clearBtn.querySelector('span:not(.spinner)');
                if (label) label.textContent = 'Click again to confirm';
                // Visual confirm state: warning style + warning icon + title
                clearBtn.classList.remove('btn-primary');
                clearBtn.classList.add('btn-warning');
                clearBtn.setAttribute('title', 'Click again to confirm');
                const icon = clearBtn.querySelector('i');
                if (icon) {
                    icon.classList.remove('fa-broom');
                    icon.classList.add('fa-exclamation-triangle');
                }
                // Always show a toast so users on compact layouts see the confirmation
                window.notify?.toast({
                    type: 'warning',
                    title: 'Confirm',
                    message: 'Click Clear Cache again to confirm',
                    duration: 3500,
                });
                setTimeout(() => {
                    clearBtn.removeAttribute('data-confirm');
                    const s = clearBtn.querySelector('span:not(.spinner)');
                    if (s) s.textContent = 'Clear Cache';
                    clearBtn.classList.remove('btn-warning');
                    clearBtn.classList.add('btn-primary');
                    clearBtn.setAttribute('title', 'Clear image cache from disk');
                    const ic = clearBtn.querySelector('i');
                    if (ic) {
                        ic.classList.remove('fa-exclamation-triangle');
                        ic.classList.add('fa-broom');
                    }
                }, 5000);
                return;
            }
            try {
                const t = window.notify?.toast({
                    type: 'info',
                    title: 'Clearing cache…',
                    message: 'Deleting cached images from disk…',
                    duration: 0,
                });
                clearBtn.disabled = true;
                clearBtn.setAttribute('aria-busy', 'true');
                clearBtn.classList.add('btn-loading');
                const res = await fetch('/api/admin/clear-image-cache', {
                    method: 'POST',
                    credentials: 'include',
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data?.error || 'Failed to clear cache');
                t?.dismiss && t.dismiss();
                const msg = data?.message || 'Image cache cleared';
                window.notify?.toast({
                    type: 'success',
                    title: 'Cache cleared',
                    message: msg,
                    duration: 3500,
                });
            } catch (e) {
                console.warn('Clear cache failed', e);
                window.notify?.toast({
                    type: 'error',
                    title: 'Clear failed',
                    message: e?.message || 'Unable to clear cache',
                    duration: 5000,
                });
            } finally {
                clearBtn.disabled = false;
                clearBtn.removeAttribute('aria-busy');
                clearBtn.classList.remove('btn-loading');
                // Ensure button label and style return to default state after action
                const span = clearBtn.querySelector('span:not(.spinner)');
                if (span) span.textContent = 'Clear Cache';
                clearBtn.classList.remove('btn-warning');
                clearBtn.classList.add('btn-primary');
                clearBtn.setAttribute('title', 'Clear image cache from disk');
                const icon = clearBtn.querySelector('i');
                if (icon) {
                    icon.classList.remove('fa-exclamation-triangle');
                    icon.classList.add('fa-broom');
                }
                clearBtn.removeAttribute('data-confirm');
                refreshCacheStatsV2();
            }
        });
    }

    // --- Config Backups UI (Operations) ---
    async function renderConfigBackups() {
        const list = document.getElementById('cfg-backup-list');
        if (!list) return;
        list.innerHTML = '<div class="subtle">Loading…</div>';
        try {
            const r = await fetch('/api/admin/config-backups', {
                credentials: 'include',
                cache: 'no-store',
            });
            const arr = r.ok ? await r.json() : [];
            if (!Array.isArray(arr) || !arr.length) {
                list.innerHTML = '<div class="subtle">No backups found</div>';
                return;
            }
            list.innerHTML = '';
            arr.forEach(b => {
                const item = document.createElement('div');
                item.className = 'backup-item';
                const created = new Date(b.createdAt || Date.now());
                const count = (b.files || []).length;
                const summary = document.createElement('div');
                summary.className = 'backup-summary';
                summary.innerHTML = `
                                        <div class="left">
                    <i class="fas fa-archive"></i>
                    <strong>${b.id}</strong>
                                        <span class="subtle">${created.toLocaleString()}</span>
                                        <span class="subtle">• ${count} files</span>
                  </div>
                  <div class="right">
                                        <button class="btn btn-link btn-sm" title="Toggle details"><i class="fas fa-chevron-down"></i></button>
                                        <button class="btn btn-link btn-sm" title="Delete"><i class="fas fa-trash"></i></button>
                  </div>`;
                item.appendChild(summary);
                const details = document.createElement('div');
                details.className = 'backup-details';
                details.style.display = 'none';
                // Group files by Core/Data visual buckets
                const buckets = { Core: [], Data: [] };
                (b.files || []).forEach(f => {
                    const coreNames = ['config.json', 'device-presets.json', '.env'];
                    buckets[coreNames.includes(f.name) ? 'Core' : 'Data'].push(f);
                });
                const makeGroup = (title, files) => {
                    const wrap = document.createElement('div');
                    wrap.className = 'backup-group';
                    wrap.setAttribute('data-group', title);
                    wrap.innerHTML = `<div class="group-title">${title}</div>`;
                    const listWrap = document.createElement('div');
                    listWrap.className = 'backup-files';
                    files.forEach(f => {
                        const row = document.createElement('div');
                        row.className = 'backup-file-row';
                        const base = f.name.split('/').pop();
                        const label = base.replace('.json', '').replace(/-/g, ' ');
                        const icon =
                            f.name === 'config.json' || f.name.startsWith('config/')
                                ? 'fa-sliders-h'
                                : f.name === 'device-presets.json'
                                  ? 'fa-layer-group'
                                  : f.name === 'devices.json'
                                    ? 'fa-display'
                                    : f.name === 'groups.json'
                                      ? 'fa-object-group'
                                      : f.name === '.env'
                                        ? 'fa-key'
                                        : 'fa-file-alt';
                        const subtitle =
                            f.name === 'config.json'
                                ? 'Application settings'
                                : f.name === 'device-presets.json'
                                  ? 'Default device configuration'
                                  : f.name === 'devices.json'
                                    ? 'Registered devices list'
                                    : f.name === 'groups.json'
                                      ? 'Device groups and assignments'
                                      : f.name === '.env'
                                        ? 'Environment variables (API keys, secrets)'
                                        : f.name;
                        row.innerHTML = `
                            <div class="file-left">
                                <i class="fas ${icon}"></i>
                                <div class="file-text">
                                    <div class="file-title">${label}</div>
                                    <div class="file-subtle">${subtitle}</div>
                                </div>
                            </div>
                            <div class="file-right">
                                <button class="btn btn-secondary btn-xs">Restore</button>
                            </div>`;
                        const btn = row.querySelector('button');
                        btn.addEventListener('click', async () => {
                            const ok = await confirmAction({
                                title: 'Restore file',
                                message: `Restore ${label}?`,
                                okText: 'Restore',
                                okClass: 'btn-secondary',
                            });
                            if (!ok) return;
                            btn.disabled = true;
                            try {
                                const r2 = await fetch('/api/admin/config-backups/restore', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    credentials: 'include',
                                    body: JSON.stringify({ backupId: b.id, file: f.name }),
                                });
                                const j2 = await r2.json().catch(() => ({}));
                                if (!r2.ok) throw new Error(j2?.error || 'Restore failed');
                                window.notify?.toast({
                                    type: 'success',
                                    title: 'Restored',
                                    message: label,
                                    duration: 2500,
                                });
                            } catch (e) {
                                window.notify?.toast({
                                    type: 'error',
                                    title: 'Restore failed',
                                    message: e?.message || 'Please try again',
                                    duration: 4000,
                                });
                            } finally {
                                btn.disabled = false;
                            }
                        });
                        listWrap.appendChild(row);
                    });
                    wrap.appendChild(listWrap);
                    return wrap;
                };
                details.appendChild(makeGroup('Core', buckets.Core));
                details.appendChild(makeGroup('Data', buckets.Data));
                item.appendChild(details);
                const [btnToggle, btnDelete] = summary.querySelectorAll('button');
                btnToggle.addEventListener('click', () => {
                    const open = details.style.display !== 'none';
                    details.style.display = open ? 'none' : '';
                    const ic = btnToggle.querySelector('i');
                    ic?.classList.toggle('fa-chevron-down', open);
                    ic?.classList.toggle('fa-chevron-up', !open);
                });
                btnDelete.addEventListener('click', async () => {
                    const ok = await confirmAction({
                        title: 'Delete backup',
                        message: 'Delete this backup?',
                        okText: 'Delete',
                        okClass: 'btn-error',
                    });
                    if (!ok) return;
                    btnDelete.disabled = true;
                    try {
                        const rdel = await fetch(
                            `/api/admin/config-backups/${encodeURIComponent(b.id)}`,
                            { method: 'DELETE', credentials: 'include' }
                        );
                        const jdel = await rdel.json().catch(() => ({}));
                        if (!rdel.ok) throw new Error(jdel?.error || 'Delete failed');
                        window.notify?.toast({
                            type: 'success',
                            title: 'Deleted',
                            message: b.id,
                            duration: 2000,
                        });
                        await renderConfigBackups();
                    } catch (e) {
                        window.notify?.toast({
                            type: 'error',
                            title: 'Delete failed',
                            message: e?.message || 'Please try again',
                            duration: 4000,
                        });
                    } finally {
                        btnDelete.disabled = false;
                    }
                });
                list.appendChild(item);
            });
        } catch (_) {
            list.innerHTML = '<div class="subtle">Failed to load</div>';
        }
    }

    // Wire buttons and schedule controls
    const btnCreateCfgBackup = document.getElementById('btn-create-cfg-backup');
    const btnCleanupCfgBackups = document.getElementById('btn-cleanup-cfg-backups');
    btnCreateCfgBackup?.addEventListener('click', async () => {
        try {
            btnCreateCfgBackup.classList.add('btn-loading');
            const r = await fetch('/api/admin/config-backups', {
                method: 'POST',
                credentials: 'include',
            });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j?.error || 'Backup failed');
            window.notify?.toast({
                type: 'success',
                title: 'Backup created',
                message: j?.id || '',
                duration: 2500,
            });
            await renderConfigBackups();
        } catch (e) {
            window.notify?.toast({
                type: 'error',
                title: 'Backup failed',
                message: e?.message || 'Please try again',
                duration: 4000,
            });
        } finally {
            btnCreateCfgBackup.classList.remove('btn-loading');
        }
    });
    btnCleanupCfgBackups?.addEventListener('click', async () => {
        const keepEl = document.getElementById('input-keep-cfg-backups');
        const keep = Math.max(1, Math.min(60, Number(keepEl?.value || 7)));
        try {
            btnCleanupCfgBackups.classList.add('btn-loading');
            const r = await fetch('/api/admin/config-backups/cleanup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ keep }),
            });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j?.error || 'Cleanup failed');
            window.notify?.toast({
                type: 'success',
                title: 'Cleaned up',
                message: `Kept ${j?.kept ?? keep}`,
                duration: 2200,
            });
            await renderConfigBackups();
        } catch (e) {
            window.notify?.toast({
                type: 'error',
                title: 'Cleanup failed',
                message: e?.message || 'Please try again',
                duration: 4000,
            });
        } finally {
            btnCleanupCfgBackups.classList.remove('btn-loading');
        }
    });
    async function loadCfgBackupSchedule() {
        try {
            const r = await fetch('/api/admin/config-backups/schedule', {
                credentials: 'include',
                cache: 'no-store',
            });
            const j = r.ok ? await r.json() : { enabled: true, time: '02:30', retention: 7 };
            const en = document.getElementById('input-cfg-backup-enabled');
            const time = document.getElementById('input-cfg-backup-time');
            const ret = document.getElementById('input-keep-cfg-backups');
            const pill = document.getElementById('cfg-backup-schedule-pill');
            if (en) en.checked = j.enabled !== false;
            if (time) time.value = String(j.time || '02:30');
            if (ret && (j.retention || j.retention === 0)) ret.value = String(j.retention);
            if (pill) {
                const enabled = j.enabled !== false;
                pill.textContent = enabled ? `Daily • ${String(j.time || '02:30')}` : 'Disabled';
                pill.classList.toggle('status-success', enabled);
                pill.classList.toggle('status-warning', !enabled);
            }
        } catch (_) {}
    }
    async function saveCfgBackupSchedule() {
        const en = document.getElementById('input-cfg-backup-enabled');
        const time = document.getElementById('input-cfg-backup-time');
        const ret = document.getElementById('input-keep-cfg-backups');
        try {
            const payload = {
                enabled: !!en?.checked,
                time: (time?.value || '02:30').slice(0, 5),
                retention: Math.max(1, Math.min(60, Number(ret?.value || 7))),
            };
            const r = await fetch('/api/admin/config-backups/schedule', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload),
            });
            if (!r.ok) throw new Error('Save failed');
            window.notify?.toast({ type: 'success', title: 'Schedule saved', duration: 2000 });
            try {
                await loadCfgBackupSchedule();
            } catch (_) {}
        } catch (e) {
            window.notify?.toast({
                type: 'error',
                title: 'Save failed',
                message: e?.message || 'Please try again',
                duration: 4000,
            });
        }
    }
    document
        .getElementById('btn-save-cfg-backup-schedule')
        ?.addEventListener('click', saveCfgBackupSchedule);
    // Load list and schedule when Operations becomes visible
    (function observeOpsForBackups() {
        const sec = document.getElementById('section-operations');
        if (!sec) return;
        const obs = new MutationObserver(() => {
            if (sec.classList.contains('active') && !sec.hidden) {
                renderConfigBackups();
                loadCfgBackupSchedule();
            }
        });
        obs.observe(sec, { attributes: true, attributeFilter: ['class', 'hidden'] });
        if (sec.classList.contains('active') && !sec.hidden) {
            renderConfigBackups();
            loadCfgBackupSchedule();
        }
    })();

    // Auto-refresh the backups list on relevant SSE events
    try {
        if (window.__adminSSE) {
            const s = window.__adminSSE;
            const refresh = debounce(() => {
                const sec = document.getElementById('section-operations');
                if (sec && sec.classList.contains('active') && !sec.hidden) {
                    renderConfigBackups();
                    loadCfgBackupSchedule();
                }
            }, 500);
            s.addEventListener('backup-created', refresh);
            s.addEventListener('backup-deleted', refresh);
            s.addEventListener('backup-restored', refresh);
            s.addEventListener('backup-cleanup', refresh);
        }
    } catch (_) {}

    // format uptime helper (not used everywhere but kept for parity/UI)
    // eslint-disable-next-line no-unused-vars
    function formatUptime(sec) {
        const s = Math.max(0, Math.floor(Number(sec) || 0));
        // Show seconds for sub-minute uptimes (e.g., 45s)
        if (s < 60) return `${s}s`;
        const d = Math.floor(s / 86400);
        const h = Math.floor((s % 86400) / 3600);
        const m = Math.floor((s % 3600) / 60);
        if (d > 0) return `${d}d ${h}h`;
        if (h > 0) return `${h}h ${m}m`;
        return `${m}m`;
    }

    // Debug helper
    const __debugOn = (() => {
        try {
            const params = new URLSearchParams(location.search);
            if (params.get('debug') === '1') return true;
            if (localStorage.getItem('admin2Debug') === '1') return true;
        } catch (_) {
            // ignore
        }
        return false;
    })();
    const dbg = (...args) => {
        if (__debugOn) {
            try {
                // eslint-disable-next-line no-console
                console.debug('[admin2]', ...args);
            } catch (_) {
                // ignore
            }
        }
    };

    function showSection(id) {
        dbg('showSection()', { id });
        const sections = document.querySelectorAll('.app-section');
        sections.forEach(s => {
            s.classList.remove('active');
            s.hidden = s.id !== id; // ensure visibility aligns with active section
        });
        const target = document.getElementById(id);
        if (target) {
            target.classList.add('active');
            target.hidden = false;
        }
        // Update header title for basic context switch
        const pageHeader = document.querySelector('.page-header');
        const h1 = pageHeader?.querySelector('h1');
        const subtitle = pageHeader?.querySelector('p');
        if (pageHeader && h1) {
            if (id === 'section-media-sources') {
                // Hide the big page header for Media Sources (use compact in-panel header)
                pageHeader.style.display = 'none';
            } else if (id === 'section-operations') {
                // Hide the big page header for Operations (use compact in-panel header)
                pageHeader.style.display = 'none';
            } else if (id === 'section-devices') {
                // Hide the big page header for Device Management (use compact in-panel header)
                pageHeader.style.display = 'none';
            } else if (id === 'section-display') {
                // Hide the big page header for Display Settings (placeholder uses compact panel)
                pageHeader.style.display = 'none';
            } else {
                // Default (Dashboard and any other sections using the big header)
                pageHeader.style.display = '';
                h1.innerHTML = '<i class="fas fa-gauge-high"></i> Dashboard';
                if (subtitle) subtitle.textContent = 'Devices, media, and health at a glance';
            }
        }
        dbg('showSection() applied', { activeId: id, sections: sections.length });

        // Show/hide Activity pill - only show on dashboard
        const activityPill = document.getElementById('perf-activity');
        if (activityPill) {
            if (id === 'section-dashboard') {
                activityPill.style.display = '';
            } else {
                activityPill.style.display = 'none';
            }
        }

        // Live dashboard KPIs: start/stop polling based on active section
        try {
            if (id === 'section-dashboard') {
                startDashboardLive();
                startPerfLive();
            } else {
                stopDashboardLive();
                stopPerfLive();
            }
        } catch (_) {
            /* non-fatal */
        }

        // Lazy-init Display section when it becomes visible
        try {
            if (id === 'section-display' && !window.__displayInit) {
                window.__displayInit = true;
                initDisplaySection();
            }
        } catch (_) {}
    }

    // Ensure a custom select UI (trigger + popup list) reflects the current value of the hidden <select>
    function syncCustomSelect(selectEl) {
        if (!selectEl) return;
        const wrap = selectEl.closest?.('.select-wrap');
        if (!wrap) return;
        const custom = wrap.querySelector?.('.custom-select');
        if (custom) {
            // Update trigger icon + label
            const trigger = custom.querySelector('.custom-select-trigger');
            const icon = trigger?.querySelector('.left > i');
            const label = trigger?.querySelector('.left > span:last-child');
            const selectedText = selectEl.options[selectEl.selectedIndex]?.text || 'Select';
            if (icon) {
                // Local icon map covering TMDB and TVDB
                const iconForFn = val => {
                    switch (val) {
                        // Shared ratings/popularity
                        case 'top_rated':
                        case 'tv_top_rated':
                            return 'fas fa-star';
                        case 'popular':
                        case 'tv_popular':
                            return 'fas fa-fire';
                        // TMDB Movies
                        case 'now_playing':
                            return 'fas fa-ticket-alt';
                        case 'upcoming':
                            return 'fas fa-calendar-alt';
                        case 'latest':
                        case 'tv_latest':
                            return 'fas fa-bolt';
                        // TMDB TV-specific
                        case 'tv_on_the_air':
                            return 'fas fa-broadcast-tower';
                        case 'tv_airing_today':
                            return 'fas fa-tv';
                        // TMDB Trending
                        case 'trending_all_day':
                        case 'trending_movie_day':
                        case 'trending_tv_day':
                        case 'trending_all_week':
                        case 'trending_movie_week':
                        case 'trending_tv_week':
                            return 'fas fa-chart-line';
                        // TMDB Discover/Collections
                        case 'discover_movie':
                        case 'discover_tv':
                            return 'fas fa-compass';
                        // TVDB-specific
                        case 'recently_updated':
                            return 'fas fa-sync-alt';
                        case 'newest':
                            return 'fas fa-film';
                        case 'oldest':
                            return 'fas fa-hourglass-half';
                        case 'trending':
                            return 'fas fa-chart-line';
                        case 'recently_added':
                            return 'fas fa-plus';
                        case 'alphabetical':
                            return 'fas fa-font';
                        default:
                            return 'fas fa-list';
                    }
                };
                icon.className = iconForFn(selectEl.value);
            }
            if (label) label.textContent = selectedText;
        }
        // Update overlay icon (if present next to the native select)
        const overlayIcon = wrap.querySelector?.('.select-icon i');
        if (overlayIcon) {
            const mapIcon = val => {
                switch (val) {
                    // Shared ratings/popularity
                    case 'top_rated':
                    case 'tv_top_rated':
                        return 'fas fa-star';
                    case 'popular':
                    case 'tv_popular':
                        return 'fas fa-fire';
                    // TMDB Movies
                    case 'now_playing':
                        return 'fas fa-ticket-alt';
                    case 'upcoming':
                        return 'fas fa-calendar-alt';
                    case 'latest':
                    case 'tv_latest':
                        return 'fas fa-bolt';
                    // TMDB TV-specific
                    case 'tv_on_the_air':
                        return 'fas fa-broadcast-tower';
                    case 'tv_airing_today':
                        return 'fas fa-tv';
                    // TMDB Trending
                    case 'trending_all_day':
                    case 'trending_movie_day':
                    case 'trending_tv_day':
                    case 'trending_all_week':
                    case 'trending_movie_week':
                    case 'trending_tv_week':
                        return 'fas fa-chart-line';
                    // TMDB Discover/Collections
                    case 'discover_movie':
                    case 'discover_tv':
                        return 'fas fa-compass';
                    // TVDB-specific
                    case 'recently_updated':
                        return 'fas fa-sync-alt';
                    case 'newest':
                        return 'fas fa-film';
                    case 'oldest':
                        return 'fas fa-hourglass-half';
                    case 'trending':
                        return 'fas fa-chart-line';
                    case 'recently_added':
                        return 'fas fa-plus';
                    case 'alphabetical':
                        return 'fas fa-font';
                    default:
                        return 'fas fa-list';
                }
            };
            overlayIcon.className = mapIcon(selectEl.value);
        }
        // Update popup list selection if it exists (identified by data-select-id)
        try {
            const list = document.querySelector(
                `.custom-options[data-select-id="${CSS.escape(selectEl.id)}"]`
            );
            if (list) {
                list.querySelectorAll('.custom-option').forEach(optEl => {
                    const on = optEl.dataset.value === selectEl.value;
                    if (on) optEl.setAttribute('aria-selected', 'true');
                    else optEl.removeAttribute('aria-selected');
                });
            }
        } catch (_) {
            // ignore if CSS.escape not available or DOM not ready
        }
    }

    // ---------- Display Section Wiring ----------
    function getVal(id) {
        return document.getElementById(id);
    }

    function setRadioGroupActive(val) {
        const segs = [
            { id: 'seg-saver', value: 'screensaver' },
            { id: 'seg-wallart', value: 'wallart' },
            { id: 'seg-cinema', value: 'cinema' },
        ];
        segs.forEach(s => {
            const el = document.getElementById(s.id);
            if (!el) return;
            const active = s.value === val;
            el.setAttribute('aria-checked', String(active));
        });
    }

    function updateModeBadges(active) {
        // Show only the active mode card; others are hidden and disabled
        const cs = document.getElementById('card-screensaver');
        const cw = document.getElementById('card-wallart');
        const cc = document.getElementById('card-cinema');
        if (cs) cs.hidden = active !== 'screensaver';
        if (cw) cw.hidden = active !== 'wallart';
        if (cc) cc.hidden = active !== 'cinema';

        document
            .getElementById('fs-screensaver')
            ?.toggleAttribute('disabled', active !== 'screensaver');
        document.getElementById('fs-wallart')?.toggleAttribute('disabled', active !== 'wallart');
        document.getElementById('fs-cinema')?.toggleAttribute('disabled', active !== 'cinema');

        // Update header pill with current mode
        const pill = document.getElementById('display-mode-pill');
        if (pill) {
            const label =
                active === 'screensaver'
                    ? 'Screensaver'
                    : active === 'wallart'
                      ? 'Wallart'
                      : 'Cinema';
            // Reset classes and apply mode-specific highlight
            pill.classList.remove('pill-screensaver', 'pill-wallart', 'pill-cinema');
            const modeClass =
                active === 'screensaver'
                    ? 'pill-screensaver'
                    : active === 'wallart'
                      ? 'pill-wallart'
                      : 'pill-cinema';
            pill.classList.add(modeClass);
            // Add an icon for extra visual weight
            const icon =
                active === 'screensaver'
                    ? '<i class="fas fa-image" aria-hidden="true"></i>'
                    : active === 'wallart'
                      ? '<i class="fas fa-images" aria-hidden="true"></i>'
                      : '<i class="fas fa-tv" aria-hidden="true" style="transform: rotate(90deg);"></i>';
            pill.innerHTML = `${icon} <span class="mode-label">Mode:</span> ${label}`;
        }
        // Note: Screensaver now contains its own cards (Visual, Clock, Scaling, Effects, Playback, Sync).
        // No separate shared container toggling is needed anymore.
    }

    async function loadAdminConfig() {
        const r = await fetch('/api/admin/config', { credentials: 'include' });
        if (!r.ok) throw new Error('Failed to load config');
        return r.json();
    }

    function hydrateDisplayForm(cfg) {
        const c = cfg?.config || cfg || {};
        const w = c.wallartMode || {};
        // Active mode rules: cinema > wallart > screensaver
        const active = c.cinemaMode ? 'cinema' : w.enabled ? 'wallart' : 'screensaver';
        setRadioGroupActive(active);
        updateModeBadges(active);

        // Global values
        const setIf = (id, val) => {
            const el = getVal(id);
            if (!el || val === undefined || val === null) return;
            if (el.type === 'checkbox') el.checked = !!val;
            else el.value = String(val);
        };
        setIf('transitionIntervalSeconds', c.transitionIntervalSeconds);
        setIf('transitionEffect', c.transitionEffect || 'kenburns');
        setIf('effectPauseTime', c.effectPauseTime);
        setIf('clockWidget', c.clockWidget !== false);
        setIf('clockFormat', c.clockFormat || '24h');
        setIf('clockTimezone', c.clockTimezone || 'auto');
        setIf('showPoster', c.showPoster !== false);
        setIf('showMetadata', c.showMetadata !== false);
        setIf('showClearLogo', c.showClearLogo !== false);
        setIf('showRottenTomatoes', c.showRottenTomatoes === true);
        // Map 0–100 schema -> 0–10 UI (snap to .0 or .5). If value looks like 0–10 already, keep it.
        (function () {
            const raw = c.rottenTomatoesMinimumScore;
            if (raw == null) return setIf('rottenTomatoesMinimumScore', 0);
            const num = Number(raw);
            if (!Number.isFinite(num)) return setIf('rottenTomatoesMinimumScore', 0);
            const uiRaw = num > 10 ? num / 10 : num;
            // Clamp 0..10 and snap to nearest 0.5
            const clamped = Math.min(10, Math.max(0, uiRaw));
            const snapped = Math.round(clamped * 2) / 2;
            setIf('rottenTomatoesMinimumScore', snapped);
        })();
        const us = c.uiScaling || {};
        setIf('uiScaling.global', us.global ?? 100);
        setIf('uiScaling.content', us.content ?? 100);
        setIf('uiScaling.clearlogo', us.clearlogo ?? 100);
        setIf('uiScaling.clock', us.clock ?? 100);
        // Sync
        setIf('syncEnabled', c.syncEnabled !== false);
        if (typeof c.syncAlignMaxDelayMs !== 'undefined')
            setIf('syncAlignMaxDelayMs', c.syncAlignMaxDelayMs);

        // Screensaver: no screensaver-only numeric fields to hydrate here (refresh lives under Operations)

        // Wallart
        setIf('wallartMode.density', w.density || 'medium');
        setIf('wallartMode.refreshRate', w.refreshRate ?? 6);
        setIf('wallartMode.randomness', w.randomness ?? 3);
        setIf('wallartMode.animationType', w.animationType || 'fade');
        setIf('wallartMode.layoutVariant', w.layoutVariant || 'heroGrid');
        setIf('wallartMode.ambientGradient', w.ambientGradient === true);
        // Columns / Items per screen / Grid transition removed in Admin v2; Density controls layout.
        const hg = (w.layoutSettings && w.layoutSettings.heroGrid) || {};
        setIf('wallartMode.layoutSettings.heroGrid.heroSide', hg.heroSide || 'left');
        setIf(
            'wallartMode.layoutSettings.heroGrid.heroRotationMinutes',
            hg.heroRotationMinutes ?? 10
        );
        setIf(
            'wallartMode.layoutSettings.heroGrid.biasAmbientToHero',
            hg.biasAmbientToHero !== false
        );

        // Wallart: show hero settings only for heroGrid layout
        try {
            const layoutSel = document.getElementById('wallartMode.layoutVariant');
            const heroSideRow = document
                .getElementById('wallartMode.layoutSettings.heroGrid.heroSide')
                ?.closest('.form-row');
            const heroRotRow = document
                .getElementById('wallartMode.layoutSettings.heroGrid.heroRotationMinutes')
                ?.closest('.form-row');
            const heroBiasRow = document
                .getElementById('wallartMode.layoutSettings.heroGrid.biasAmbientToHero')
                ?.closest('.form-row');
            const applyHeroVis = () => {
                const isHero = layoutSel?.value === 'heroGrid';
                [heroSideRow, heroRotRow, heroBiasRow].forEach(row => {
                    if (row) row.style.display = isHero ? '' : 'none';
                });
                const heroCard = document.getElementById('wallart-hero-card');
                if (heroCard) heroCard.style.display = isHero ? '' : 'none';
            };
            layoutSel?.addEventListener('change', applyHeroVis);
            applyHeroVis();
        } catch (_) {}

        // Cinema
        setIf('cinemaOrientation', c.cinemaOrientation || 'auto');

        // Wire radio changes after hydration to update UI states
        const radios = document.querySelectorAll('input[name="display.mode"]');
        radios.forEach(r =>
            r.addEventListener('change', () => {
                const value = document.querySelector('input[name="display.mode"]:checked')?.value;
                if (value) {
                    setRadioGroupActive(value);
                    updateModeBadges(value);
                }
            })
        );

        // Update slider labels for modern sliders
        try {
            // Create lightweight progress bars behind native sliders without changing their appearance
            (function initSliderBars() {
                const ids = [
                    'uiScaling.global',
                    'uiScaling.content',
                    'uiScaling.clearlogo',
                    'uiScaling.clock',
                    'wallartMode.refreshRate',
                    'wallartMode.randomness',
                ];
                const updateBar = inputEl => {
                    try {
                        const wrap = inputEl.closest('.modern-slider');
                        if (!wrap) return;
                        const bar = wrap.querySelector('.slider-bar');
                        const fill = bar && bar.querySelector('.fill');
                        if (!bar || !fill) return;
                        const min = Number(inputEl.min || 0);
                        const max = Number(inputEl.max || 100);
                        const val = Number(inputEl.value || 0);
                        const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
                        fill.style.width = pct + '%';
                    } catch (_) {}
                };
                ids.forEach(id => {
                    const el = getVal(id);
                    if (!el) return;
                    const wrap = el.closest('.modern-slider');
                    if (wrap && !wrap.querySelector('.slider-bar')) {
                        const bar = document.createElement('div');
                        bar.className = 'slider-bar';
                        const fill = document.createElement('div');
                        fill.className = 'fill';
                        bar.appendChild(fill);
                        wrap.appendChild(bar);
                    }
                    updateBar(el);
                    el.addEventListener('input', () => updateBar(el));
                    el.addEventListener('change', () => updateBar(el));
                });
            })();
            const labelFor = (id, val) => {
                if (id === 'wallartMode.refreshRate') {
                    const v = Number(val);
                    const map = [
                        'Very slow',
                        'Slow',
                        'Med‑slow',
                        'Medium',
                        'Med‑fast',
                        'Fast',
                        'Faster',
                        'Very fast',
                        'Ultra',
                        'Ludicrous',
                    ];
                    return map[Math.min(Math.max(v, 1), 10) - 1];
                }
                if (id === 'wallartMode.randomness') {
                    const v = Number(val);
                    if (v <= 2) return 'Low';
                    if (v <= 5) return 'Medium';
                    if (v <= 8) return 'High';
                    return 'Chaotic';
                }
                if (id.startsWith('uiScaling.')) return `${val}%`;
                return String(val);
            };
            const updateSliderLabel = id => {
                const el = getVal(id);
                const lab = document.querySelector(
                    `#section-display .slider-percentage[data-target="${CSS.escape(id)}"]`
                );
                if (el && lab) lab.textContent = labelFor(id, el.value);
            };
            [
                'uiScaling.global',
                'uiScaling.content',
                'uiScaling.clearlogo',
                'uiScaling.clock',
                'wallartMode.refreshRate',
                'wallartMode.randomness',
            ].forEach(id => {
                const el = getVal(id);
                if (!el) return;
                el.addEventListener('input', () => updateSliderLabel(id));
                updateSliderLabel(id);
            });
            // UI scaling preset buttons
            const applyUIScaling = vals => {
                const ids = ['global', 'content', 'clearlogo', 'clock'];
                ids.forEach(key => {
                    const el = getVal('uiScaling.' + key);
                    if (el && vals[key] != null) {
                        el.value = String(vals[key]);
                        const lab = document.querySelector(
                            `#section-display .slider-percentage[data-target="${CSS.escape('uiScaling.' + key)}"]`
                        );
                        if (lab) lab.textContent = `${vals[key]}%`;
                    }
                });
            };
            const p4k = document.getElementById('preset-4k-tv');
            const pFhd = document.getElementById('preset-full-hd');
            const pUw = document.getElementById('preset-ultrawide');
            const pReset = document.getElementById('reset-ui-scaling');
            p4k?.addEventListener('click', () =>
                applyUIScaling({ global: 120, content: 120, clearlogo: 110, clock: 110 })
            );
            pFhd?.addEventListener('click', () =>
                applyUIScaling({ global: 100, content: 100, clearlogo: 100, clock: 100 })
            );
            pUw?.addEventListener('click', () =>
                applyUIScaling({ global: 95, content: 95, clearlogo: 95, clock: 95 })
            );
            pReset?.addEventListener('click', () =>
                applyUIScaling({ global: 100, content: 100, clearlogo: 100, clock: 100 })
            );
        } catch (_) {}

        // Poster → Metadata dependency: disable metadata when poster is off
        try {
            const posterEl = document.getElementById('showPoster');
            const metaEl = document.getElementById('showMetadata');
            const applyDep = () => {
                const enabled = !!posterEl?.checked;
                if (metaEl) {
                    metaEl.disabled = !enabled;
                    if (!enabled) metaEl.checked = false;
                    const label = metaEl.closest('.form-row');
                    if (label) label.style.opacity = enabled ? '' : '.7';
                }
            };
            posterEl?.addEventListener('change', applyDep);
            applyDep();
        } catch (_) {}

        // Clock visibility: show tz/format only when clockWidget is enabled
        try {
            const clockCb = document.getElementById('clockWidget');
            const tzRow = document.getElementById('clockTimezone')?.closest('.form-row');
            const fmtRow = document.getElementById('clockFormat')?.closest('.form-row');
            const applyClock = () => {
                const on = !!clockCb?.checked;
                if (tzRow) tzRow.style.display = on ? '' : 'none';
                if (fmtRow) fmtRow.style.display = on ? '' : 'none';
            };
            clockCb?.addEventListener('change', applyClock);
            applyClock();
        } catch (_) {}

        // Screensaver cards (including Presets): customizable two-column layout
        try {
            const initModeCustomize = ({
                scope,
                containerId,
                btnStartId,
                btnDoneId,
                btnResetId,
                colLeftId,
                colRightId,
                cardSelector,
                keyAttr = 'data-card-key',
            }) => {
                const container = document.getElementById(containerId);
                const btnStart = document.getElementById(btnStartId);
                const btnDone = document.getElementById(btnDoneId);
                const btnReset = document.getElementById(btnResetId);
                const colL = document.getElementById(colLeftId);
                const colR = document.getElementById(colRightId);
                if (!container || !btnStart || !btnDone || !btnReset || !colL || !colR) return;

                const STORAGE_KEY = `display.${scope}.layout.v1`;
                const readLayout = () => {
                    try {
                        const raw = localStorage.getItem(STORAGE_KEY);
                        return raw ? JSON.parse(raw) : null;
                    } catch (_) {
                        return null;
                    }
                };
                const writeLayout = layout => {
                    try {
                        localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
                    } catch (_) {}
                };
                const getCards = () => Array.from(container.querySelectorAll(cardSelector));

                let dragEl = null;
                const enableDrag = () => {
                    getCards().forEach(el => {
                        el.setAttribute('draggable', 'true');
                        el.addEventListener('dragstart', e => {
                            dragEl = el;
                            el.classList.add('dragging');
                            e.dataTransfer?.setData(
                                'text/plain',
                                el.id || el.getAttribute(keyAttr) || ''
                            );
                        });
                        el.addEventListener('dragend', () => {
                            el.classList.remove('dragging');
                            dragEl = null;
                        });
                    });
                    [colL, colR].forEach(col => {
                        col.addEventListener('dragover', e => {
                            e.preventDefault();
                            col.classList.add('drag-over');
                        });
                        col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
                        col.addEventListener('drop', e => {
                            e.preventDefault();
                            col.classList.remove('drag-over');
                            if (!dragEl) return;
                            const after = Array.from(col.children).find(
                                child =>
                                    e.clientY <=
                                    child.getBoundingClientRect().top +
                                        child.getBoundingClientRect().height / 2
                            );
                            if (after) col.insertBefore(dragEl, after);
                            else col.appendChild(dragEl);
                        });
                    });
                };

                const enterCustomize = () => {
                    container.classList.add('customizing');
                    colL.style.display = '';
                    colR.style.display = '';
                    btnStart.style.display = 'none';
                    btnDone.style.display = '';
                    const saved = readLayout();
                    colL.innerHTML = '';
                    colR.innerHTML = '';
                    if (saved) {
                        const all = new Map(getCards().map(el => [el.getAttribute(keyAttr), el]));
                        (saved.left || []).forEach(k => {
                            const el = all.get(k);
                            if (el) colL.appendChild(el);
                        });
                        (saved.right || []).forEach(k => {
                            const el = all.get(k);
                            if (el) colR.appendChild(el);
                        });
                    } else {
                        // Default: put Presets first on the left, rest balanced by current DOM order
                        const cards = getCards();
                        const presets = cards.find(el => el.getAttribute(keyAttr) === 'presets');
                        const rest = cards.filter(el => el !== presets);
                        if (presets) colL.appendChild(presets);
                        const mid = Math.ceil(rest.length / 2);
                        rest.slice(0, mid).forEach(el => colL.appendChild(el));
                        rest.slice(mid).forEach(el => colR.appendChild(el));
                    }
                    enableDrag();
                };

                const exitCustomize = (persist = true) => {
                    if (persist) {
                        const left = Array.from(colL.children).map(ch => ch.getAttribute(keyAttr));
                        const right = Array.from(colR.children).map(ch => ch.getAttribute(keyAttr));
                        writeLayout({ left, right });
                    }
                    const all = [...Array.from(colL.children), ...Array.from(colR.children)];
                    all.forEach(el => container.appendChild(el));
                    container.classList.remove('customizing');
                    colL.style.display = 'none';
                    colR.style.display = 'none';
                    btnStart.style.display = '';
                    btnDone.style.display = 'none';
                };

                const applySaved = () => {
                    const saved = readLayout();
                    if (!saved) return;
                    const all = new Map(getCards().map(el => [el.getAttribute(keyAttr), el]));
                    const append = keys =>
                        keys.forEach(k => {
                            const el = all.get(k);
                            if (el) container.appendChild(el);
                        });
                    append(saved.left || []);
                    append(saved.right || []);
                };
                applySaved();

                btnStart.addEventListener('click', () => enterCustomize());
                btnDone.addEventListener('click', () => exitCustomize(true));
                btnReset.addEventListener('click', () => {
                    try {
                        localStorage.removeItem(`display.${scope}.layout.v1`);
                    } catch (_) {}
                    if (container.classList.contains('customizing')) enterCustomize();
                });
            };

            // Screensaver no longer supports custom layout; initializer removed.
        } catch (_) {}

        // Wallart & Cinema: customize/reset functionality removed per request.

        // Number steppers: inc/dec handlers for all .number-input-wrapper blocks in Display section
        try {
            const panel = document.getElementById('section-display');
            if (panel) {
                panel.querySelectorAll('.number-input-wrapper').forEach(wrapper => {
                    const input = wrapper.querySelector('input[type="number"]');
                    const inc = wrapper.querySelector('.number-inc');
                    const dec = wrapper.querySelector('.number-dec');
                    const step = () => Number(input?.step || '1') || 1;
                    const clamp = v => {
                        let val = v;
                        const min = input?.min === '' ? null : Number(input?.min);
                        const max = input?.max === '' ? null : Number(input?.max);
                        if (min != null && !Number.isNaN(min)) val = Math.max(val, min);
                        if (max != null && !Number.isNaN(max)) val = Math.min(val, max);
                        return val;
                    };
                    inc?.addEventListener('click', () => {
                        if (!input) return;
                        const cur = Number(input.value || '0') || 0;
                        input.value = String(clamp(cur + step()));
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                    });
                    dec?.addEventListener('click', () => {
                        if (!input) return;
                        const cur = Number(input.value || '0') || 0;
                        input.value = String(clamp(cur - step()));
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                    });
                });
            }
        } catch (_) {}

        // Rotten Tomatoes: live snap to 0.5 and clamp 0..10 while typing
        try {
            const el = document.getElementById('rottenTomatoesMinimumScore');
            if (el) {
                const snap = () => {
                    const raw = el.value;
                    if (raw == null || raw === '') return; // allow clearing while editing
                    const n = Number(raw);
                    if (!Number.isFinite(n)) return;
                    // If users paste a 0–100 value, downscale to 0–10 UX first
                    const ui = n <= 10 ? n : n / 10;
                    const clamped = Math.min(10, Math.max(0, ui));
                    const snapped = Math.round(clamped * 2) / 2; // .0 or .5
                    if (Math.abs(snapped - n) > 1e-9) {
                        // Keep consistent formatting: one decimal place at most
                        el.value = String(snapped);
                    }
                };
                ['input', 'change', 'blur'].forEach(ev => el.addEventListener(ev, snap));
            }
        } catch (_) {}

        // Screensaver: live summary + presets (affect global Effect/Playback/Clock)
        try {
            const elInterval = document.getElementById('transitionIntervalSeconds');
            const elEffect = document.getElementById('transitionEffect');
            const elPause = document.getElementById('effectPauseTime');
            const elClock = document.getElementById('clockWidget');
            const pillInt = document.getElementById('saver-summary-interval');
            const pillEff = document.getElementById('saver-summary-effect');
            const pillPause = document.getElementById('saver-summary-pause');
            const pillClock = document.getElementById('saver-summary-clock');

            const effLabel = val => {
                switch (val) {
                    case 'kenburns':
                        return 'Ken Burns';
                    case 'fade':
                        return 'Fade In/Out';
                    case 'slide':
                        return 'Slide';
                    default:
                        return String(val || '—');
                }
            };
            const pauseRow = elPause?.closest('.form-row') || null;
            const applyPauseVisibility = () => {
                const isKB = String(elEffect?.value || '').toLowerCase() === 'kenburns';
                if (pauseRow) pauseRow.style.display = isKB ? 'none' : '';
                if (elPause) elPause.disabled = isKB;
            };
            const applySummary = () => {
                if (pillInt && elInterval)
                    pillInt.textContent = `Every ${elInterval.value || '—'} s`;
                if (pillEff && elEffect)
                    pillEff.textContent = `Effect: ${effLabel(elEffect.value)}`;
                if (pillPause && elPause) {
                    const isKB = String(elEffect?.value || '').toLowerCase() === 'kenburns';
                    pillPause.textContent = isKB
                        ? 'Pause: —'
                        : `Pause: ${elPause.value != null && elPause.value !== '' ? elPause.value : '—'} s`;
                }
                if (pillClock && elClock)
                    pillClock.textContent = `Clock: ${elClock.checked ? 'On' : 'Off'}`;
            };
            ['input', 'change'].forEach(ev => {
                elInterval?.addEventListener(ev, applySummary);
                elEffect?.addEventListener(ev, () => {
                    applyPauseVisibility();
                    applySummary();
                });
                elPause?.addEventListener(ev, applySummary);
                elClock?.addEventListener(ev, applySummary);
            });
            applyPauseVisibility();
            applySummary();

            // Presets
            const btnChill = document.getElementById('saver-preset-chill');
            const btnStd = document.getElementById('saver-preset-standard');
            const btnLively = document.getElementById('saver-preset-lively');
            const btnReset = document.getElementById('saver-preset-reset');
            const setVals = ({ interval, effect, pause }) => {
                if (typeof interval === 'number' && elInterval) {
                    elInterval.value = String(interval);
                    elInterval.dispatchEvent(new Event('input', { bubbles: true }));
                    elInterval.dispatchEvent(new Event('change', { bubbles: true }));
                }
                if (typeof effect === 'string' && elEffect) {
                    elEffect.value = effect;
                    elEffect.dispatchEvent(new Event('change', { bubbles: true }));
                }
                if (typeof pause === 'number' && elPause) {
                    elPause.value = String(pause);
                    elPause.dispatchEvent(new Event('input', { bubbles: true }));
                    elPause.dispatchEvent(new Event('change', { bubbles: true }));
                }
                applySummary();
            };
            btnChill?.addEventListener('click', () =>
                setVals({ interval: 30, effect: 'kenburns', pause: 0 })
            );
            btnStd?.addEventListener('click', () =>
                setVals({ interval: 15, effect: 'fade', pause: 2 })
            );
            btnLively?.addEventListener('click', () =>
                setVals({ interval: 8, effect: 'slide', pause: 0.5 })
            );
            btnReset?.addEventListener('click', () =>
                setVals({ interval: 12, effect: 'kenburns', pause: 1 })
            );
        } catch (_) {}
    }

    function collectDisplayFormPatch() {
        const val = id => {
            const el = getVal(id);
            if (!el) return undefined;
            if (el.type === 'checkbox') return !!el.checked;
            if (el.type === 'number' || el.type === 'range') return Number(el.value);
            return el.value;
        };
        const active = document.querySelector('input[name="display.mode"]:checked')?.value;
        const wallartEnabled = active === 'wallart';
        const cinemaEnabled = active === 'cinema';
        // Build nested patch
        const patch = {
            // Global
            transitionIntervalSeconds: val('transitionIntervalSeconds'),
            transitionEffect: val('transitionEffect'),
            effectPauseTime: val('effectPauseTime'),
            clockWidget: val('clockWidget'),
            clockFormat: val('clockFormat'),
            clockTimezone: val('clockTimezone'),
            showPoster: val('showPoster'),
            showMetadata: val('showMetadata'),
            showClearLogo: val('showClearLogo'),
            showRottenTomatoes: val('showRottenTomatoes'),
            // Map 0–10 UI -> 0–100 schema; snap to nearest 0.5 and clamp 0..10; tolerate already-100 scale
            rottenTomatoesMinimumScore: (function () {
                const v = val('rottenTomatoesMinimumScore');
                if (v == null) return 0;
                const n = Number(v);
                if (!Number.isFinite(n)) return 0;
                const ui = n <= 10 ? n : n / 10;
                const clamped = Math.min(10, Math.max(0, ui));
                const snapped = Math.round(clamped * 2) / 2;
                return Math.round(snapped * 10);
            })(),
            uiScaling: {
                global: val('uiScaling.global'),
                content: val('uiScaling.content'),
                clearlogo: val('uiScaling.clearlogo'),
                clock: val('uiScaling.clock'),
            },
            // Sync
            syncEnabled: val('syncEnabled'),
            syncAlignMaxDelayMs: val('syncAlignMaxDelayMs'),
            // Modes
            cinemaMode: cinemaEnabled,
            cinemaOrientation: val('cinemaOrientation'),
            wallartMode: {
                enabled: wallartEnabled,
                density: val('wallartMode.density'),
                refreshRate: val('wallartMode.refreshRate'),
                randomness: val('wallartMode.randomness'),
                animationType: val('wallartMode.animationType'),
                layoutVariant: val('wallartMode.layoutVariant'),
                ambientGradient: val('wallartMode.ambientGradient'),
                layoutSettings: {
                    heroGrid: {
                        heroSide: val('wallartMode.layoutSettings.heroGrid.heroSide'),
                        heroRotationMinutes: val(
                            'wallartMode.layoutSettings.heroGrid.heroRotationMinutes'
                        ),
                        biasAmbientToHero: val(
                            'wallartMode.layoutSettings.heroGrid.biasAmbientToHero'
                        ),
                    },
                },
            },
            // Screensaver specific: none (backgroundRefreshMinutes managed in Operations)
        };
        // If screensaver active, ensure other modes disabled
        if (active === 'screensaver') {
            patch.cinemaMode = false;
            patch.wallartMode.enabled = false;
        }
        return patch;
    }

    async function initDisplaySection() {
        try {
            // Prefill
            const cfg = await loadAdminConfig();
            hydrateDisplayForm(cfg);

            // Default radio based on cfg
            const w = (cfg?.config || cfg)?.wallartMode || {};
            const mode = (cfg?.config || cfg)?.cinemaMode
                ? 'cinema'
                : w.enabled
                  ? 'wallart'
                  : 'screensaver';
            const radio = document.getElementById(`mode-${mode}`);
            if (radio && !radio.checked) {
                radio.checked = true;
            }
            // Ensure badges/cards reflect the chosen mode immediately
            setRadioGroupActive(mode);
            updateModeBadges(mode);

            // Save handler
            const saveBtn = document.getElementById('btn-save-display');
            saveBtn?.addEventListener('click', async () => {
                try {
                    saveBtn.classList.add('btn-loading');
                    const patch = collectDisplayFormPatch();
                    await (typeof saveConfigPatch === 'function'
                        ? saveConfigPatch(patch, {})
                        : (async () => {
                              const r = await fetch('/api/admin/config', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  credentials: 'include',
                                  body: JSON.stringify({ config: patch, env: {} }),
                              });
                              if (!r.ok) throw new Error('Save failed');
                              try {
                                  if (typeof miniCache?.delete === 'function')
                                      miniCache.delete('/api/admin/config|GET');
                                  if (typeof inflight?.delete === 'function')
                                      inflight.delete('/api/admin/config|GET');
                              } catch (_) {}
                          })());
                    window.notify?.toast({
                        type: 'success',
                        title: 'Display saved',
                        message: 'Settings saved successfully',
                        duration: 2000,
                    });
                } catch (e) {
                    window.notify?.toast({
                        type: 'error',
                        title: 'Save failed',
                        message: e?.message || 'Could not save display settings',
                        duration: 3500,
                    });
                } finally {
                    saveBtn?.classList.remove('btn-loading');
                }
            });
        } catch (e) {
            window.notify?.toast({
                type: 'error',
                title: 'Load failed',
                message: e?.message || 'Could not load display settings',
            });
        }
    }

    async function refreshApiKeyStatus() {
        try {
            // API key status
            const statusRes = await fetch('/api/admin/api-key/status', { credentials: 'include' });
            const status = statusRes.ok ? await statusRes.json() : { hasKey: false };
            const hasKey = !!status?.hasKey;
            const statusText = document.getElementById('api-key-status-text');
            const statusPill = document.getElementById('api-key-status-pill');
            const display = document.getElementById('api-key-display');
            const revokeBtn = document.getElementById('revoke-api-key-button');
            if (statusText) statusText.textContent = hasKey ? 'Present' : 'None';
            if (statusPill) {
                statusPill.classList.remove('status-success', 'status-warning');
                statusPill.classList.add(hasKey ? 'status-success' : 'status-warning');
            }
            if (display) display.classList.toggle('is-hidden', !hasKey);
            if (revokeBtn) revokeBtn.disabled = !hasKey;
            if (hasKey) {
                // Fetch the masked value (we'll still show as password field)
                const keyRes = await fetch('/api/admin/api-key', { credentials: 'include' });
                const keyData = keyRes.ok ? await keyRes.json() : { apiKey: '' };
                const input = document.getElementById('api-key-input');
                if (input) input.value = keyData.apiKey || '';
            }
        } catch (e) {
            console.warn('API key status refresh failed', e);
        }
    }

    async function refreshSecurity() {
        // Note: Security panel has been removed, this function is kept for compatibility
        // with existing 2FA handlers in the user menu
        console.log('Security panel refresh requested (panel removed, skipping)');
    }

    function openModal(id) {
        const m = document.getElementById(id);
        if (!m) return;
        m.classList.add('open');
    }
    function closeModal(id) {
        const m = document.getElementById(id);
        if (!m) return;
        m.classList.remove('open');
    }
    async function confirmAction({
        title = 'Confirm',
        message = 'Are you sure?',
        okText = 'Confirm',
        okClass = 'btn-primary',
    } = {}) {
        return new Promise(resolve => {
            const overlay = document.getElementById('modal-confirm');
            if (!overlay) return resolve(false);
            overlay.removeAttribute('hidden');
            const titleEl = document.getElementById('modal-confirm-title');
            const bodyEl = document.getElementById('modal-confirm-body');
            const okBtn = document.getElementById('modal-confirm-ok');
            if (titleEl) titleEl.innerHTML = `<i class="fas fa-question-circle"></i> ${title}`;
            if (bodyEl) bodyEl.textContent = message;
            if (okBtn) {
                okBtn.className = `btn ${okClass}`;
                okBtn.innerHTML = `<i class="fas fa-check"></i><span>${okText}</span>`;
            }
            function cleanup(val) {
                overlay.classList.remove('open');
                overlay.setAttribute('hidden', '');
                okBtn?.removeEventListener('click', onOk);
                cancelBtn?.removeEventListener('click', onCancel);
                closeBtns.forEach(b => b.removeEventListener('click', onCancel));
                resolve(val);
            }
            function onOk() {
                cleanup(true);
            }
            function onCancel() {
                cleanup(false);
            }
            const cancelBtn = overlay.querySelector('[data-close-modal]');
            const closeBtns = overlay.querySelectorAll('[data-close-modal]');
            okBtn?.addEventListener('click', onOk);
            closeBtns.forEach(b => b.addEventListener('click', onCancel));
            overlay.classList.add('open');
        });
    }

    function wireEvents() {
        // Prevent duplicate wiring (DOMContentLoaded + immediate call race)
        if (window.__admin2Wired) return;
        window.__admin2Wired = true;
        // Live updates via SSE (logs). Falls back to polling below.
        (function initAdminEvents() {
            try {
                // Debounced notifier used by all SSE events
                const pump = debounce(() => {
                    try {
                        if (typeof window.refreshAdminBadge === 'function') {
                            window.refreshAdminBadge();
                        }
                    } catch (_) {}
                }, 2000);

                // Create/restore SSE with backoff when closed
                let reconnectTimer = null;
                function establishSSE() {
                    try {
                        const existing = window.__adminSSE;
                        if (existing && existing.readyState !== 2 /* CLOSED */) return;
                    } catch (_) {}

                    try {
                        const src = new EventSource('/api/admin/events');
                        window.__adminSSE = src;

                        src.addEventListener('log', () => pump());
                        src.addEventListener('hello', () => pump());
                        // Generic message fallback
                        src.addEventListener('message', () => pump());
                        // Some servers emit keepalive pings; treat as an update nudge
                        src.addEventListener('ping', () => pump());
                        src.onopen = () => {
                            // Clear any planned reconnect attempts and nudge UI
                            if (reconnectTimer) {
                                clearTimeout(reconnectTimer);
                                reconnectTimer = null;
                            }
                            pump();
                        };
                        // When config changes (e.g., cache size), refresh cache stats panel immediately
                        src.addEventListener('config-updated', async () => {
                            try {
                                await refreshCacheStatsV2();
                            } catch (_) {
                                /* ignore */
                            }
                        });
                        src.onerror = () => {
                            // If the stream is fully closed, clear handle and try to re-establish
                            try {
                                if (src.readyState === 2 /* CLOSED */) {
                                    try {
                                        src.close();
                                    } catch (_) {}
                                    if (window.__adminSSE === src) window.__adminSSE = null;
                                    if (!reconnectTimer) {
                                        reconnectTimer = setTimeout(() => {
                                            reconnectTimer = null;
                                            establishSSE();
                                        }, 3000);
                                    }
                                }
                            } catch (_) {}
                        };
                    } catch (_) {
                        // If creation fails (e.g., endpoint down), retry with backoff
                        if (!reconnectTimer) {
                            reconnectTimer = setTimeout(() => {
                                reconnectTimer = null;
                                establishSSE();
                            }, 5000);
                        }
                    }
                }

                establishSSE();
            } catch (_) {
                // Ignore if EventSource not available or endpoint not reachable; polling remains
            }
        })();

        // Mobile sidebar toggle demo behavior
        const toggle = $('#mobile-nav-toggle');
        const overlay = $('#sidebar-overlay');
        const sidebar = document.querySelector('.sidebar');
        toggle?.addEventListener('click', () => {
            const open = sidebar?.classList.toggle('open');
            overlay && (overlay.hidden = !open);
            toggle.setAttribute('aria-expanded', String(!!open));
        });
        overlay?.addEventListener('click', () => {
            sidebar?.classList.remove('open');
            overlay.hidden = true;
            toggle?.setAttribute('aria-expanded', 'false');
        });

        // Settings dropdown
        const settingsBtn = document.getElementById('settings-btn');
        const settingsMenu = document.getElementById('settings-menu');

        function closeMenu() {
            if (!settingsMenu) return;
            settingsBtn?.setAttribute('aria-expanded', 'false');
            settingsMenu?.setAttribute('aria-hidden', 'true');
            settingsMenu?.classList.remove('show');
            // Hide the menu properly
            settingsMenu.style.display = 'none';
            settingsMenu.style.opacity = '0';
            settingsMenu.style.pointerEvents = 'none';
        }

        // Click-to-open only; hover-open removed
        settingsBtn?.addEventListener('click', e => {
            console.log('Settings button clicked!');
            e.stopPropagation();
            if (!settingsMenu) return;
            const willOpen = !settingsMenu?.classList.contains('show');
            console.log('Settings menu will open:', willOpen);
            if (willOpen) {
                // Ensure the user menu is closed when opening settings
                try {
                    typeof closeUserMenu === 'function' && closeUserMenu();
                } catch (_) {}
                // Also ensure notifications panel is closed when opening settings
                try {
                    if (window.__closeNotifyCenter) window.__closeNotifyCenter();
                    else {
                        const panel = document.getElementById('notify-center');
                        const btn = document.getElementById('notif-btn');
                        panel?.classList.remove('open');
                        btn?.setAttribute('aria-expanded', 'false');
                    }
                } catch (_) {}
                settingsMenu?.classList.add('show');
                // Show and dynamically position within viewport
                const dd = document.getElementById('settings-dropdown');
                settingsMenu.style.display = 'block';
                settingsMenu.style.position = 'absolute';
                settingsMenu.style.top = 'calc(100% + 8px)';
                settingsMenu.style.zIndex = '2000';
                settingsMenu.style.opacity = '1';
                settingsMenu.style.pointerEvents = 'auto';
                // Reset anchors
                settingsMenu.style.left = 'auto';
                settingsMenu.style.right = 'auto';
                // Default: align left edge with button
                settingsMenu.style.left = '0';
                // Compute overflow and flip if needed
                requestAnimationFrame(() => {
                    try {
                        const menuRect = settingsMenu.getBoundingClientRect();
                        const dropdownRect = dd?.getBoundingClientRect();
                        const vw = Math.max(
                            document.documentElement.clientWidth,
                            window.innerWidth || 0
                        );
                        // If the right edge overflows, anchor to the right of the dropdown instead
                        if (menuRect.right > vw && dropdownRect) {
                            settingsMenu.style.left = 'auto';
                            settingsMenu.style.right = '0';
                        }
                        // If still overflowing left, clamp width and stick to viewport
                        const updatedRect = settingsMenu.getBoundingClientRect();
                        if (updatedRect.left < 0) {
                            const maxWidth = Math.min(280, vw - 16);
                            settingsMenu.style.maxWidth = maxWidth + 'px';
                            settingsMenu.style.left = '8px';
                            settingsMenu.style.right = 'auto';
                        }
                    } catch (err) {
                        console.warn('Settings menu positioning error', err);
                    }
                });
                console.log('Settings menu opened');
            } else {
                closeMenu();
            }
            settingsBtn.setAttribute('aria-expanded', String(willOpen));
            settingsMenu?.setAttribute('aria-hidden', String(!willOpen));
        });
        // Hover-based auto-close removed; menus are click-to-toggle only
        document.addEventListener('click', e => {
            if (!settingsMenu) return;
            if (!e.target.closest('#settings-dropdown')) closeMenu();
        });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') closeMenu();
        });
        // Close settings menu when any item (except restart confirmation flow) is clicked
        settingsMenu?.addEventListener('click', e => {
            const item = e.target.closest('a.dropdown-item');
            if (!item) return;
            if (item.id !== 'menu-restart') closeMenu();
        });

        // Notifications bell: themed Notification Center panel (matches theme-demo)
        (function initNotifications() {
            const btn = document.getElementById('notif-btn');
            const badge = document.getElementById('notif-count');
            // const menu = document.getElementById('notif-menu'); // legacy, unused
            const panel = document.getElementById('notify-center');
            const list = document.getElementById('notify-list');
            // const btnMarkAll = document.getElementById('notify-mark-all');
            // const btnClose = document.getElementById('notify-close');
            if (!btn || !badge || !panel || !list) return;

            // Helper to always get fresh references (soft refresh safe)
            function getRefs() {
                return {
                    btn: document.getElementById('notif-btn'),
                    badge: document.getElementById('notif-count'),
                    panel: document.getElementById('notify-center'),
                    list: document.getElementById('notify-list'),
                };
            }

            // Keep a dismissed set (persisted) so items don't bounce back after refresh
            const dismissed = new Set();
            const DISMISS_STORE = 'admin2:dismissedNotifications';
            // Dismiss TTLs: alerts linger longer; logs (repetitive) return sooner
            const DISMISS_TTL_ALERT_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
            const DISMISS_TTL_LOG_MS = 60 * 60 * 1000; // 1 hour for logs (prevents long-term suppression of WARN spam)
            const CLEAR_SUPPRESS_KEY = 'admin2:notifClearedUntil';
            const CLEAR_SUPPRESS_MS = 15000; // 15s grace to avoid racey repaints
            // Notification data cache to avoid hammering endpoints
            const FETCH_TTL_MS = 10000; // 10s TTL for alerts/logs
            let __notifCache = { data: null, ts: 0 };
            let __notifInflight = null;
            // Unified badge updater to avoid lingering empty badge visuals
            function setBadge(count) {
                try {
                    const { badge } = getRefs();
                    if (!badge) return;
                    const n = Math.max(0, Number(count) || 0);
                    if (n > 0) {
                        badge.textContent = String(n);
                        badge.hidden = false;
                        badge.style.display = '';
                        badge.setAttribute('aria-hidden', 'false');
                    } else {
                        badge.textContent = '';
                        badge.hidden = true;
                        badge.style.display = 'none';
                        badge.setAttribute('aria-hidden', 'true');
                    }
                } catch (_) {}
            }
            function loadDismissed() {
                try {
                    const raw = localStorage.getItem(DISMISS_STORE);
                    const list = raw ? JSON.parse(raw) : [];
                    const now = Date.now();
                    if (Array.isArray(list)) {
                        list.forEach(entry => {
                            if (!entry || typeof entry.key !== 'string') return;
                            const k = entry.key;
                            const isAlert = k.startsWith('A|');
                            const isLog = k.startsWith('L|');
                            const ttl = isAlert
                                ? DISMISS_TTL_ALERT_MS
                                : isLog
                                  ? DISMISS_TTL_LOG_MS
                                  : DISMISS_TTL_ALERT_MS; // default to longer
                            if (now - (entry.t || 0) < ttl) {
                                dismissed.add(k);
                            }
                        });
                    }
                } catch (_) {}
            }
            function persistDismissed() {
                try {
                    const now = Date.now();
                    const arr = Array.from(dismissed).map(key => ({ key, t: now }));
                    localStorage.setItem(DISMISS_STORE, JSON.stringify(arr));
                } catch (_) {}
            }
            // Load persisted dismissed notifications on init
            loadDismissed();

            const normalize = s =>
                String(s || '')
                    .toLowerCase()
                    .replace(/\s+/g, ' ')
                    .trim();
            const makeAlertKey = a => {
                const base = String(a?.id || a?.name || '');
                const msg = normalize(a?.message || a?.description || '');
                return `A|${base}|${msg}`;
            };
            // Use level + normalized message + minute bucket so dismissing doesn't hide future occurrences forever
            const makeLogKey = l => {
                let ms = 0;
                try {
                    const t = l?.timestamp;
                    ms = typeof t === 'number' ? t : Date.parse(String(t));
                    if (!Number.isFinite(ms)) ms = 0;
                } catch (_) {}
                const bucket = Math.floor(ms / 60000); // minute-level bucket
                return `L|${String(l?.level || 'warn')}|${normalize(l?.message || '')}|${bucket}`;
            };
            function applyDismissedFilter(alerts, logs) {
                const fa = (Array.isArray(alerts) ? alerts : []).filter(
                    a => !dismissed.has(makeAlertKey(a))
                );
                const fl = (Array.isArray(logs) ? logs : []).filter(
                    l => !dismissed.has(makeLogKey(l))
                );
                return { alerts: fa, logs: fl };
            }
            function updateBadgeFromList() {
                const { list } = getRefs();
                if (!list) return setBadge(0);
                const unread = list.querySelectorAll('.notify-item[data-unread="true"]').length;
                setBadge(unread);
            }

            const NOTIF_MAX_ITEMS_KEY = 'admin2:notifMaxItems';
            function getNotifMaxItems() {
                try {
                    const v = Number(localStorage.getItem(NOTIF_MAX_ITEMS_KEY));
                    if (Number.isFinite(v) && v > 0 && v <= 100) return Math.floor(v);
                } catch (_) {}
                return 100; // default increased
            }

            async function fetchAlertsAndLogs(opts = {}) {
                const force = !!opts.force;
                const now = Date.now();
                try {
                    if (!force) {
                        if (__notifInflight) return __notifInflight;
                        if (__notifCache.data && now - __notifCache.ts < FETCH_TTL_MS) {
                            return __notifCache.data;
                        }
                    }
                } catch (_) {}

                // Build a single-flight promise for both alerts and logs
                __notifInflight = (async () => {
                    // Dedup + backoff for dashboard metrics inside notifications too
                    if (!window.__metricsCooldownUntil) window.__metricsCooldownUntil = 0;
                    const nowInner = Date.now();
                    const useCooldown = nowInner < window.__metricsCooldownUntil;
                    let alerts = [];
                    let logs = [];
                    try {
                        let data = null;
                        if (!useCooldown) {
                            if (typeof window.dedupJSON === 'function') {
                                const res = await window.dedupJSON('/api/v1/metrics/dashboard');
                                if (res && res.status === 429) {
                                    window.__metricsCooldownUntil = Date.now() + 30_000; // 30s
                                } else if (res && res.ok) {
                                    data = await res.json();
                                }
                            } else {
                                data = await fetchJSON('/api/v1/metrics/dashboard').catch(
                                    () => null
                                );
                            }
                        }
                        alerts = Array.isArray(data?.alerts) ? data.alerts : [];
                    } catch (_) {}
                    try {
                        // Respect user-selected minimum level for logs in the bell
                        const levelKey = 'admin2:notifMinLevel';
                        let minLevel = (localStorage.getItem(levelKey) || 'warn').toLowerCase();
                        if (minLevel === 'warning') minLevel = 'warn';
                        const levelParam = ['info', 'warn', 'error'].includes(minLevel)
                            ? minLevel
                            : 'warn';
                        const limit = getNotifMaxItems();
                        const r = await fetch(
                            `/api/admin/logs?level=${levelParam}&limit=${limit}`,
                            {
                                credentials: 'include',
                            }
                        );
                        if (r.ok) {
                            const jr = (await r.json()) || [];
                            logs = Array.isArray(jr)
                                ? jr
                                : Array.isArray(jr?.logs)
                                  ? jr.logs
                                  : Array.isArray(jr?.items)
                                    ? jr.items
                                    : [];
                        }
                    } catch (_) {}
                    return { alerts, logs };
                })();

                try {
                    const res = await __notifInflight;
                    __notifInflight = null;
                    if (res) {
                        __notifCache = { data: res, ts: Date.now() };
                    }
                    return res || { alerts: [], logs: [] };
                } catch (e) {
                    __notifInflight = null;
                    return { alerts: [], logs: [] };
                }
            }

            function renderPanel({ alerts, logs }) {
                const parts = [];
                const maxItems = getNotifMaxItems();
                // Local time formatter for this panel
                function fmtAgoLite(ms) {
                    if (!ms || Number.isNaN(ms)) return '';
                    const now = Date.now();
                    const diff = Math.max(0, now - ms);
                    const sec = Math.floor(diff / 1000);
                    if (sec < 5) return 'Just now';
                    if (sec < 60) return `${sec}s ago`;
                    const min = Math.floor(sec / 60);
                    if (min < 60) return `${min}m ago`;
                    const hr = Math.floor(min / 60);
                    if (hr < 24) return `${hr}h ago`;
                    const day = Math.floor(hr / 24);
                    return `${day}d ago`;
                }
                function toMs(ts) {
                    if (!ts && ts !== 0) return 0;
                    const ms = typeof ts === 'number' ? ts : Date.parse(String(ts));
                    return Number.isFinite(ms) ? ms : 0;
                }
                function formatWhenMs(ms) {
                    if (!Number.isFinite(ms) || ms <= 0) return '';
                    return fmtAgoLite(ms);
                }
                function iconForLevel(st) {
                    switch (st) {
                        case 'success':
                            return 'fa-check';
                        case 'error':
                            return 'fa-exclamation';
                        case 'info':
                            return 'fa-circle-info';
                        case 'warning':
                        default:
                            return 'fa-triangle-exclamation';
                    }
                }
                if (Array.isArray(alerts) && alerts.length) {
                    for (const a of alerts.slice(0, maxItems)) {
                        const raw = String(a?.status || 'warn').toLowerCase();
                        const st =
                            raw === 'error'
                                ? 'error'
                                : raw === 'info'
                                  ? 'info'
                                  : raw === 'success' || raw === 'ok' || raw === 'done'
                                    ? 'success'
                                    : 'warning';
                        const icon = iconForLevel(st);
                        const title = escapeHtml(String(a?.name || a?.id || 'Alert'));
                        const msg = escapeHtml(String(a?.message || a?.description || ''));
                        const ms = toMs(a?.timestamp || a?.time || a?.date);
                        const when = formatWhenMs(ms);
                        const meta = [when, msg].filter(Boolean).join(' \u00B7 ');
                        const rawKey = makeAlertKey(a);
                        const key = encodeURIComponent(rawKey);
                        parts.push({
                            ts: ms,
                            html: `<div class="notify-item notify-${st}" data-unread="true" data-key="${key}">
                                    <i class="fas ${icon}" aria-hidden="true"></i>
                                    <div>
                                        <div class="notify-title">${title}</div>
                                        ${meta ? `<div class="notify-meta">${meta}</div>` : ''}
                                    </div>
                                    <button class="notify-close" title="Dismiss"><i class="fas fa-xmark"></i></button>
                                 </div>`,
                        });
                    }
                }
                if (Array.isArray(logs) && logs.length) {
                    for (const l of logs.slice(0, maxItems)) {
                        const raw = String(l?.level || l?.severity || 'warn').toLowerCase();
                        const st = raw === 'error' ? 'error' : raw === 'info' ? 'info' : 'warning';
                        const icon = iconForLevel(st);
                        const msg = escapeHtml(String(l?.message || ''));
                        const ms = toMs(l?.timestamp);
                        const when = formatWhenMs(ms);
                        const rawKey = makeLogKey(l);
                        const key = encodeURIComponent(rawKey);
                        parts.push({
                            ts: ms,
                            html: `<div class="notify-item notify-${st}" data-unread="true" data-key="${key}">
                                    <i class="fas ${icon}" aria-hidden="true"></i>
                                    <div>
                                        <div class="notify-title">${msg || 'Log'}</div>
                                        ${when ? `<div class="notify-meta">${when}</div>` : ''}
                                    </div>
                                    <button class="notify-close" title="Dismiss"><i class="fas fa-xmark"></i></button>
                                 </div>`,
                        });
                    }
                }
                const { list } = getRefs();
                if (list) {
                    if (parts.length) {
                        const html = parts
                            .sort((a, b) => (b.ts || 0) - (a.ts || 0))
                            .map(p => p.html)
                            .join('');
                        list.innerHTML = html;
                    } else {
                        list.innerHTML =
                            '<div class="notify-item notify-empty"><div class="notify-title" style="grid-column:1 / -1; text-align:center; opacity:.85;">No notifications</div></div>';
                    }
                } else {
                    setBadge(0);
                }
            }

            async function refreshBadge(force = false) {
                try {
                    // Suppression window after user clears notifications (avoid bounce-back)
                    try {
                        const until = Number(localStorage.getItem(CLEAR_SUPPRESS_KEY) || 0);
                        if (Date.now() < until) {
                            setBadge(0);
                            const { list } = getRefs();
                            if (list)
                                list.innerHTML =
                                    '<div class="notify-item notify-empty"><div class="notify-title" style="grid-column:1 / -1; text-align:center; opacity:.85;">No notifications</div></div>';
                            return;
                        }
                    } catch (_) {}
                    let { alerts, logs } = await fetchAlertsAndLogs({ force });
                    // Apply session dismissals so cleared items don't bounce back immediately
                    ({ alerts, logs } = applyDismissedFilter(alerts, logs));
                    const maxItems = getNotifMaxItems();
                    const shownAlerts = Math.min(
                        Array.isArray(alerts) ? alerts.length : 0,
                        maxItems
                    );
                    const shownLogs = Math.min(Array.isArray(logs) ? logs.length : 0, maxItems);
                    const count = shownAlerts + shownLogs;
                    setBadge(count);
                    renderPanel({ alerts, logs });
                } catch (_) {
                    setBadge(0);
                    const { list } = getRefs();
                    if (list)
                        list.innerHTML =
                            '<div class="notify-item notify-empty"><div class="notify-title" style="grid-column:1 / -1; text-align:center; opacity:.85;">No notifications</div></div>';
                }
            }
            // Expose to global shim so SSE can trigger it without scoping issues
            try {
                window.refreshAdminBadge = refreshBadge;
            } catch (_) {}

            function openPanel() {
                const { panel, btn } = getRefs();
                panel?.classList.add('open');
                btn?.setAttribute('aria-expanded', 'true');
            }
            function closePanel() {
                const { panel, btn } = getRefs();
                panel?.classList.remove('open');
                btn?.setAttribute('aria-expanded', 'false');
            }

            // Expose close/open so other header menus can close notifications when they open
            try {
                window.__closeNotifyCenter = closePanel;
                window.__openNotifyCenter = openPanel;
            } catch (_) {}

            // Initialize min-level selector (hidden) + compact icon filter bindings
            (function initMinLevelControl() {
                try {
                    const key = 'admin2:notifMinLevel';
                    const sel = document.getElementById('notify-min-level');
                    const container = document.getElementById('notify-min-level-icons');
                    let saved = (localStorage.getItem(key) || 'warn').toLowerCase();
                    if (saved === 'warning') saved = 'warn';
                    // Sync hidden select if present
                    if (sel && [...sel.options].some(o => o.value === saved)) sel.value = saved;
                    // Helper to update aria-checked on icon buttons
                    function paint(v) {
                        if (!container) return;
                        container.querySelectorAll('.nf-btn').forEach(btn => {
                            btn.setAttribute('aria-checked', String(btn.dataset.level === v));
                        });
                    }
                    paint(saved);
                    // Click handling on compact icons
                    container?.addEventListener('click', e => {
                        const btn = e.target.closest?.('.nf-btn');
                        if (!btn) return;
                        const v = String(btn.dataset.level || '').toLowerCase();
                        if (!v) return;
                        localStorage.setItem(key, v);
                        if (sel) sel.value = v;
                        paint(v);
                        // Force-refresh to reflect new min level immediately
                        try {
                            refreshBadge(true);
                        } catch (_) {}
                    });
                    // Keep existing change binding on hidden select as fallback (e.g., accessibility tools)
                    sel?.addEventListener('change', () => {
                        try {
                            const v = sel.value;
                            localStorage.setItem(key, v);
                            paint(v);
                            refreshBadge(true);
                        } catch (_) {}
                    });
                } catch (_) {}
            })();

            // Guard to avoid duplicate bindings if init runs again
            if (!window.__notifHandlersAdded) {
                window.__notifHandlersAdded = true;
                // Delegated toggle open on bell
                document.addEventListener('click', async e => {
                    const notifBtn = e.target.closest?.('#notif-btn');
                    if (notifBtn) {
                        e.stopPropagation();
                        const { panel } = getRefs();
                        const isOpen = panel?.classList.contains('open');
                        if (isOpen) {
                            // Toggle: if open, close it
                            closePanel();
                        } else {
                            // Ensure other header menus are closed when opening notifications
                            try {
                                typeof closeMenu === 'function' && closeMenu();
                            } catch (_) {}
                            try {
                                typeof closeUserMenu === 'function' && closeUserMenu();
                            } catch (_) {}
                            // Force bypass TTL when the user explicitly opens the panel
                            await refreshBadge(true);
                            openPanel();
                        }
                        return;
                    }
                    // Close when clicking outside
                    const { panel } = getRefs();
                    if (panel && !panel.contains(e.target) && !e.target.closest('#notif-btn')) {
                        closePanel();
                    }
                    // Close via header X
                    const closeBtn = e.target.closest?.('#notify-close');
                    if (closeBtn) {
                        e.preventDefault();
                        closePanel();
                        return;
                    }
                });
                document.addEventListener('keydown', e => {
                    if (e.key === 'Escape') closePanel();
                });
                // Refresh when tab becomes visible again (soft refresh/resume)
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'visible') {
                        try {
                            refreshBadge();
                        } catch (_) {}
                    }
                });
                // Refresh on pageshow (including back/forward cache restores)
                window.addEventListener('pageshow', () => {
                    try {
                        refreshBadge();
                    } catch (_) {}
                });

                // Observe DOM mutations to handle soft DOM swaps (e.g., partial renders)
                try {
                    if (!window.__notifMO) {
                        const mo = new MutationObserver(
                            debounce(() => {
                                // If our key nodes exist (or re-appeared), re-sync the badge and list
                                const center = document.getElementById('notify-center');
                                const countEl = document.getElementById('notif-count');
                                if (center || countEl) {
                                    try {
                                        refreshBadge();
                                    } catch (_) {}
                                }
                            }, 120)
                        );
                        mo.observe(document.body, { childList: true, subtree: true });
                        window.__notifMO = mo;
                    }
                } catch (_) {
                    /* ignore */
                }
            }

            // Delegated actions for dismiss and mark-all to survive soft refreshes/DOM swaps
            document.addEventListener('click', e => {
                const dismissBtn = e.target.closest?.('.notify-item .notify-close');
                if (dismissBtn) {
                    e.preventDefault();
                    e.stopPropagation();
                    const item = dismissBtn.closest('.notify-item');
                    const { list } = getRefs();
                    if (item) {
                        const keyAttr = item.getAttribute('data-key');
                        const key = keyAttr ? decodeURIComponent(keyAttr) : null;
                        if (key) dismissed.add(key);
                        item.remove();
                        // If list is now empty, show the empty state explicitly
                        if (list && !list.querySelector('.notify-item[data-unread="true"]')) {
                            list.innerHTML =
                                '<div class="notify-item notify-empty"><div class="notify-title" style="grid-column:1 / -1; text-align:center; opacity:.85;">No notifications</div></div>';
                        }
                        updateBadgeFromList();
                        persistDismissed();
                    }
                    return;
                }
                const markAllBtn = e.target.closest?.('#notify-mark-all');
                if (markAllBtn) {
                    e.preventDefault();
                    e.stopPropagation();
                    const { list } = getRefs();
                    list?.querySelectorAll('.notify-item[data-unread="true"]').forEach(item => {
                        const keyAttr = item.getAttribute('data-key');
                        const key = keyAttr ? decodeURIComponent(keyAttr) : null;
                        if (key) dismissed.add(key);
                    });
                    persistDismissed();
                    if (list)
                        list.innerHTML =
                            '<div class="notify-item notify-empty"><div class="notify-title" style="grid-column:1 / -1; text-align:center; opacity:.85;">No notifications</div></div>';
                    // Hide and clear the badge explicitly after marking all
                    setBadge(0);
                    updateBadgeFromList();
                    try {
                        localStorage.setItem(
                            CLEAR_SUPPRESS_KEY,
                            String(Date.now() + CLEAR_SUPPRESS_MS)
                        );
                    } catch (_) {}
                    // Re-sync from source after a short delay to respect suppression
                    setTimeout(() => {
                        try {
                            refreshBadge();
                        } catch (_) {}
                    }, 250);
                }
            });
            // The delegated handler above covers mark-all; avoid double-binding here

            // Periodically refresh the badge regardless of active section (tab-visible only)
            const badgeTick = debounce(() => {
                try {
                    if (document.visibilityState !== 'visible') return;
                    if (typeof window.refreshAdminBadge === 'function') window.refreshAdminBadge();
                    else refreshBadge();
                } catch (_) {}
            }, 500);
            setInterval(badgeTick, 15000);

            // While the notification panel is open, refresh more frequently for a live feel
            setInterval(() => {
                try {
                    if (document.visibilityState !== 'visible') return;
                    const { panel } = getRefs();
                    if (panel && panel.classList.contains('open')) {
                        if (typeof window.refreshAdminBadge === 'function')
                            window.refreshAdminBadge();
                        else refreshBadge();
                    }
                } catch (_) {}
            }, 5000);

            // Initial paint so users see counts without clicking
            try {
                refreshBadge();
            } catch (_) {}

            // Refresh aggressively on network regain and window focus
            try {
                window.addEventListener('online', () => {
                    try {
                        refreshBadge(true);
                    } catch (_) {}
                });
                window.addEventListener('focus', () => {
                    try {
                        refreshBadge();
                    } catch (_) {}
                });
            } catch (_) {}
        })();

        // User dropdown (Account)
        const userBtn = document.getElementById('user-btn');
        const userMenu = document.getElementById('user-menu');

        function closeUserMenu() {
            if (!userMenu) return;
            userBtn?.setAttribute('aria-expanded', 'false');
            userMenu?.setAttribute('aria-hidden', 'true');
            userMenu?.classList.remove('show');
            // Hide the menu properly
            userMenu.style.display = 'none';
            userMenu.style.opacity = '0';
            userMenu.style.pointerEvents = 'none';
        }
        userBtn?.addEventListener('click', e => {
            console.log('User button clicked!');
            e.stopPropagation();
            if (!userMenu) return;
            const willOpen = !userMenu?.classList.contains('show');
            console.log('User menu will open:', willOpen);
            if (willOpen) {
                // Ensure the settings menu is closed when opening user menu
                try {
                    typeof closeMenu === 'function' && closeMenu();
                } catch (_) {}
                // Also ensure notifications panel is closed when opening user menu
                try {
                    if (window.__closeNotifyCenter) window.__closeNotifyCenter();
                    else {
                        const panel = document.getElementById('notify-center');
                        const btn = document.getElementById('notif-btn');
                        panel?.classList.remove('open');
                        btn?.setAttribute('aria-expanded', 'false');
                    }
                } catch (_) {}
                userMenu.classList.add('show');
                // Add same inline styles as settings menu
                userMenu.style.display = 'block';
                userMenu.style.position = 'absolute';
                userMenu.style.top = 'calc(100% + 8px)';
                userMenu.style.zIndex = '2000';
                userMenu.style.opacity = '1';
                userMenu.style.pointerEvents = 'auto';
                console.log('User menu opened');
            } else {
                userMenu.classList.remove('show');
            }
            userBtn.setAttribute('aria-expanded', String(willOpen));
            userMenu?.setAttribute('aria-hidden', String(!willOpen));
        });
        document.addEventListener('click', e => {
            if (!userMenu) return;
            if (!e.target.closest('#user-dropdown')) closeUserMenu();
        });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') closeUserMenu();
        });
        // Hover-based auto-close removed; user menu is click-to-toggle only
        // Route account actions to modals (with graceful fallbacks)
        document.getElementById('user-change-password')?.addEventListener('click', e => {
            e.preventDefault();
            closeUserMenu();
            const modal = document.getElementById('modal-change-password');
            if (modal) {
                openModal('modal-change-password');
            } else {
                window.notify?.toast?.({
                    type: 'info',
                    title: 'Account',
                    message: 'Change password is not available in this build.',
                    duration: 2400,
                });
            }
        });
        document.getElementById('user-two-fa')?.addEventListener('click', e => {
            e.preventDefault();
            closeUserMenu();
            // Open the appropriate modal based on current 2FA status
            (async () => {
                try {
                    const cfg = await fetch('/api/admin/config', { credentials: 'include' })
                        .then(r => r.json())
                        .catch(() => ({}));
                    const is2FA = !!cfg?.security?.is2FAEnabled;

                    if (is2FA) {
                        // 2FA is enabled, open disable modal
                        const m = document.getElementById('modal-2fa-disable');
                        if (m) openModal('modal-2fa-disable');
                        else
                            window.notify?.toast?.({
                                type: 'info',
                                title: 'Two‑Factor',
                                message: '2FA disable UI is not available in this build.',
                                duration: 2400,
                            });
                    } else {
                        // 2FA is disabled, generate QR and open enable modal
                        const r = await fetch('/api/admin/2fa/generate', {
                            method: 'POST',
                            credentials: 'include',
                        });
                        if (r.ok) {
                            const j = await r.json().catch(() => ({}));
                            const qr = document.getElementById('qr-code-container');
                            if (qr) {
                                qr.innerHTML = j.qrCodeDataUrl
                                    ? `<img src="${j.qrCodeDataUrl}" alt="Scan QR code" style="background:#fff;padding:8px;border-radius:8px;" />`
                                    : '<span>QR unavailable</span>';
                            }
                        }
                        const m = document.getElementById('modal-2fa');
                        if (m) openModal('modal-2fa');
                        else
                            window.notify?.toast?.({
                                type: 'info',
                                title: 'Two‑Factor',
                                message: '2FA setup UI is not available in this build.',
                                duration: 2400,
                            });
                    }
                } catch (e) {
                    console.warn('2FA menu action failed:', e);
                    // Fallback: just open settings section
                    showSection('settings');
                }
            })();
        });

        // Profile photo menu
        document.getElementById('user-profile-photo')?.addEventListener('click', async e => {
            e.preventDefault();
            closeUserMenu();
            // Reset input
            const input = document.getElementById('avatar-file');
            if (input) input.value = '';
            // Load current avatar preview
            try {
                const resp = await fetch('/api/admin/profile/photo', {
                    cache: 'no-store',
                    credentials: 'include',
                });
                const img = document.getElementById('avatar-image-preview');
                const fallback = document.getElementById('avatar-initials-fallback');
                if (resp.status === 200 && img) {
                    const blob = await resp.blob();
                    img.src = URL.createObjectURL(blob);
                    img.style.display = 'block';
                    if (fallback) fallback.style.display = 'none';
                } else {
                    if (img) {
                        img.removeAttribute('src');
                        img.style.display = 'none';
                    }
                    if (fallback) fallback.style.display = '';
                }
            } catch (_) {
                // ignore
            }
            const m = document.getElementById('modal-avatar');
            if (m) openModal('modal-avatar');
            else
                window.notify?.toast?.({
                    type: 'info',
                    title: 'Profile',
                    message: 'Profile photo editor is not available in this build.',
                    duration: 2400,
                });
        });

        // Build avatar initials for user button (fallback to AD) with theme-friendly cool palette
        try {
            const hashCode = str => {
                let h = 0;
                for (let i = 0; i < str.length; i++) h = (h << 5) - h + str.charCodeAt(i);
                return h >>> 0;
            };
            const btn = document.getElementById('user-btn');
            if (btn) {
                (async () => {
                    const nameEl = btn.querySelector('span');
                    const label = (nameEl?.textContent || 'Admin').trim();
                    try {
                        const r = await fetch('/api/admin/profile/photo', {
                            cache: 'no-store',
                            credentials: 'include',
                        });
                        if (r.status === 200) {
                            const blob = await r.blob();
                            const url = URL.createObjectURL(blob);
                            const icon = btn.querySelector('i.fas.fa-user-circle');
                            const existingInitials = btn.querySelector('.avatar-initials');
                            if (icon || existingInitials) {
                                const img = document.createElement('img');
                                img.className = 'avatar-img';
                                img.alt = 'Profile photo';
                                img.src = url;
                                (icon || existingInitials).replaceWith(img);
                                return;
                            }
                        }
                    } catch (_) {
                        /* ignore */
                    }
                    // Fallback to initials if no image available
                    const parts = label.split(/\s+/).filter(Boolean);
                    const initials =
                        parts.length >= 2
                            ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
                            : (label.slice(0, 2) || 'AD').toUpperCase();
                    const icon = btn.querySelector('i.fas.fa-user-circle');
                    if (icon && !btn.querySelector('.avatar-initials')) {
                        const av = document.createElement('span');
                        av.className = 'avatar-initials';
                        av.textContent = initials;
                        const palette = [
                            'hsl(226 72% 52%)',
                            'hsl(248 65% 55%)',
                            'hsl(210 80% 52%)',
                            'hsl(262 55% 52%)',
                            'hsl(192 60% 42%)',
                            'hsl(222 50% 40%)',
                        ];
                        const idx = hashCode(label) % palette.length;
                        av.style.backgroundColor = palette[idx];
                        av.style.color = '#ffffff';
                        av.style.border = '1px solid var(--color-border)';
                        icon.replaceWith(av);
                    }
                })();
            }
        } catch (_) {
            /* ignore */
        }

        // Avatar modal actions
        const uploadBtn = document.getElementById('avatar-upload-btn');
        const removeBtn = document.getElementById('avatar-remove-btn');
        const fileInput = document.getElementById('avatar-file');
        const fileTrigger = document.getElementById('avatar-file-trigger');
        const fileNameEl = document.getElementById('avatar-file-name');
        const previewImg = document.getElementById('avatar-image-preview');
        const previewFallback = document.getElementById('avatar-initials-fallback');
        const uploadDropZone = document.getElementById('upload-drop-zone');
        const selectedFileDisplay = document.getElementById('selected-file-display');

        // Open native file picker from themed button
        fileTrigger?.addEventListener('click', () => fileInput?.click());

        // Drag and drop functionality
        uploadDropZone?.addEventListener('dragover', e => {
            e.preventDefault();
            uploadDropZone.style.borderColor = 'var(--color-primary)';
            uploadDropZone.style.background = 'rgba(var(--color-primary-rgb, 99, 102, 241), 0.05)';
            uploadDropZone.style.transform = 'scale(1.02)';
        });

        uploadDropZone?.addEventListener('dragleave', e => {
            e.preventDefault();
            uploadDropZone.style.borderColor = 'rgba(255,255,255,0.2)';
            uploadDropZone.style.background = 'rgba(255,255,255,0.01)';
            uploadDropZone.style.transform = 'scale(1)';
        });

        uploadDropZone?.addEventListener('drop', e => {
            e.preventDefault();
            uploadDropZone.style.borderColor = 'rgba(255,255,255,0.2)';
            uploadDropZone.style.background = 'rgba(255,255,255,0.01)';
            uploadDropZone.style.transform = 'scale(1)';

            const files = e.dataTransfer.files;
            if (files.length > 0) {
                const file = files[0];
                if (file.type.startsWith('image/')) {
                    handleFileSelection(file);
                } else {
                    window.notify?.toast({
                        type: 'warning',
                        title: 'Invalid File',
                        message: 'Please select an image file (PNG, JPG, or WebP)',
                        duration: 3000,
                    });
                }
            }
        });

        // Click to upload on drop zone
        uploadDropZone?.addEventListener('click', () => fileInput?.click());

        // File input change handler
        fileInput?.addEventListener('change', () => {
            const f = fileInput.files?.[0];
            if (f) {
                handleFileSelection(f);
            }
        });

        function handleFileSelection(file) {
            // Check file size (2MB limit)
            if (file.size > 2 * 1024 * 1024) {
                window.notify?.toast({
                    type: 'error',
                    title: 'File Too Large',
                    message: 'File size must be less than 2 MB',
                    duration: 3000,
                });
                return;
            }

            // Update file name display
            if (fileNameEl) fileNameEl.textContent = file.name;
            if (selectedFileDisplay) selectedFileDisplay.style.display = 'block';

            // Show preview
            const url = URL.createObjectURL(file);
            if (previewImg) {
                previewImg.src = url;
                previewImg.style.display = 'block';
            }
            if (previewFallback) previewFallback.style.display = 'none';

            // Set the file input for later upload
            const dt = new DataTransfer();
            dt.items.add(file);
            fileInput.files = dt.files;
        }

        // Live preview when selecting a file
        uploadBtn?.addEventListener('click', async () => {
            const fileInput = document.getElementById('avatar-file');
            const files = fileInput?.files;
            if (!files || !files[0]) {
                window.notify?.toast({
                    type: 'warning',
                    title: 'Profile',
                    message: 'Select an image first',
                    duration: 2000,
                });
                return;
            }
            const form = new FormData();
            form.append('avatar', files[0]);
            uploadBtn.setAttribute('aria-busy', 'true');
            uploadBtn.disabled = true;
            uploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Uploading...</span>';
            try {
                const r = await fetch('/api/admin/profile/photo', {
                    method: 'POST',
                    body: form,
                    credentials: 'include',
                });
                if (!r.ok) {
                    const err = await r.json().catch(() => ({}));
                    throw new Error(err?.error || 'Upload failed');
                }
                // Update navbar image immediately
                try {
                    const navBtn = document.getElementById('user-btn');
                    const imgExisting = navBtn?.querySelector('img.avatar-img');
                    const resp = await fetch('/api/admin/profile/photo', {
                        cache: 'no-store',
                        credentials: 'include',
                    });
                    if (resp.status === 200) {
                        const blob = await resp.blob();
                        const url = URL.createObjectURL(blob);
                        if (imgExisting) {
                            imgExisting.src = url;
                        } else if (navBtn) {
                            const icon =
                                navBtn.querySelector('i.fas.fa-user-circle') ||
                                navBtn.querySelector('.avatar-initials');
                            const img = document.createElement('img');
                            img.className = 'avatar-img';
                            img.alt = 'Profile photo';
                            img.src = url;
                            if (icon) icon.replaceWith(img);
                        }
                    }
                } catch (_) {
                    /* ignore */
                }
                window.notify?.toast({
                    type: 'success',
                    title: 'Profile',
                    message: 'Photo updated successfully',
                    duration: 2500,
                });
                closeModal('modal-avatar');
            } catch (e) {
                window.notify?.toast({
                    type: 'error',
                    title: 'Profile',
                    message: e.message || 'Upload failed',
                    duration: 3000,
                });
            } finally {
                uploadBtn.removeAttribute('aria-busy');
                uploadBtn.disabled = false;
                uploadBtn.innerHTML = '<i class="fas fa-upload"></i><span>Upload</span>';
            }
        });
        removeBtn?.addEventListener('click', async () => {
            if (!confirm('Are you sure you want to remove your profile photo?')) {
                return;
            }

            removeBtn.setAttribute('aria-busy', 'true');
            removeBtn.disabled = true;
            removeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Removing...</span>';
            try {
                const r = await fetch('/api/admin/profile/photo', {
                    method: 'DELETE',
                    credentials: 'include',
                });
                if (!r.ok) throw new Error('Remove failed');
                // Swap navbar to initials
                const navBtn = document.getElementById('user-btn');
                if (navBtn) {
                    const existing = navBtn.querySelector('img.avatar-img');
                    if (existing) {
                        const nameEl = navBtn.querySelector('span');
                        const label = (nameEl?.textContent || 'Admin').trim();
                        const parts = label.split(/\s+/).filter(Boolean);
                        const initials =
                            parts.length >= 2
                                ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
                                : (label.slice(0, 2) || 'AD').toUpperCase();
                        const span = document.createElement('span');
                        span.className = 'avatar-initials';
                        span.textContent = initials;
                        const palette = [
                            'hsl(226 72% 52%)',
                            'hsl(248 65% 55%)',
                            'hsl(210 80% 52%)',
                            'hsl(262 55% 52%)',
                            'hsl(192 60% 42%)',
                            'hsl(222 50% 40%)',
                        ];
                        const idx =
                            (function hc(s) {
                                let h = 0;
                                for (let i = 0; i < s.length; i++)
                                    h = (h << 5) - h + s.charCodeAt(i);
                                return h >>> 0;
                            })(label) % palette.length;
                        span.style.backgroundColor = palette[idx];
                        span.style.color = '#ffffff';
                        span.style.border = '1px solid var(--color-border)';
                        existing.replaceWith(span);
                    }
                }
                window.notify?.toast({
                    type: 'success',
                    title: 'Profile',
                    message: 'Photo removed successfully',
                    duration: 2000,
                });
                closeModal('modal-avatar');
            } catch (e) {
                window.notify?.toast({
                    type: 'error',
                    title: 'Profile',
                    message: e.message || 'Remove failed',
                    duration: 2500,
                });
            } finally {
                removeBtn.removeAttribute('aria-busy');
                removeBtn.disabled = false;
                removeBtn.innerHTML = '<i class="fas fa-trash"></i><span>Remove</span>';
            }
        });

        // Restart action under settings
        const restartLink = document.getElementById('menu-restart');
        restartLink?.addEventListener('click', async e => {
            e.preventDefault();
            const el = e.currentTarget;
            const confirming = el.getAttribute('data-confirm') === '1';
            if (!confirming) {
                el.setAttribute('data-confirm', '1');
                const span = el.querySelector('span');
                if (span) span.textContent = 'Click again to confirm';
                setTimeout(() => {
                    el.removeAttribute('data-confirm');
                    const sp = el.querySelector('span');
                    if (sp) sp.textContent = 'Restart Posterrama';
                }, 2000);
                return;
            }
            try {
                el.classList.add('disabled');
                await fetch('/api/admin/restart-app', {
                    method: 'POST',
                    credentials: 'include',
                });
                // Show persistent toast and begin polling until the server is back
                const t = window.notify?.toast({
                    type: 'info',
                    title: 'Restarting…',
                    message: 'Posterrama is restarting. This may take a few seconds.',
                    duration: 0,
                });
                const start = Date.now();
                const timeoutMs = 120000; // 2 minutes safety cap
                const poll = async () => {
                    try {
                        const r = await fetch('/health?_=' + Date.now(), { cache: 'no-store' });
                        if (r.ok) {
                            t?.dismiss && t.dismiss();
                            window.notify?.toast({
                                type: 'success',
                                title: 'Back online',
                                message: 'Server is available again. Refreshing…',
                                duration: 2000,
                            });
                            setTimeout(() => location.reload(), 800);
                            return;
                        }
                    } catch (_) {
                        /* server likely down; keep polling */
                    }
                    if (Date.now() - start < timeoutMs) {
                        setTimeout(poll, 1500);
                    } else {
                        t?.dismiss && t.dismiss();
                        window.notify?.toast({
                            type: 'warning',
                            title: 'Still restarting',
                            message:
                                'Server not reachable yet. You can refresh manually when it’s back.',
                            duration: 6000,
                        });
                    }
                };
                // Short delay to allow restart to start, then poll
                setTimeout(poll, 1500);
            } catch (_) {
                // non-fatal
            } finally {
                el.classList.remove('disabled');
            }
        });

        // Sidebar section switching (ignore group toggles)
        document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
            item.addEventListener('click', e => {
                e.preventDefault();
                const nav = item.getAttribute('data-nav');
                if (!nav) return; // skip toggles without target section
                document
                    .querySelectorAll('.sidebar-nav .nav-item')
                    .forEach(n => n.classList.remove('active'));
                // Also clear any active submenu indicators when navigating to a top-level section
                document
                    .querySelectorAll('.sidebar-nav .nav-subitem')
                    .forEach(s => s.classList.remove('active'));
                item.classList.add('active');
                if (nav === 'dashboard') {
                    showSection('section-dashboard');
                } else if (nav === 'display') {
                    // Dedicated placeholder section for Display Settings (coming soon)
                    showSection('section-display');
                } else if (nav === 'operations') {
                    showSection('section-operations');
                    // ensure latest status/backups when entering
                    refreshUpdateStatusUI();
                    refreshOperationsPanels();
                    // refresh API key status since API Access is now in Operations
                    refreshApiKeyStatus();
                } else if (nav === 'devices') {
                    showSection('section-devices');
                    try {
                        window.admin2?.initDevices?.();
                    } catch (_) {}
                } else if (nav === 'media-sources') {
                    showSection('section-media-sources');
                }
            });
        });

        // Media Sources group: toggle and sub-navigation
        const mediaGroup = document.querySelector('.nav-group');
        const toggleLink = mediaGroup?.querySelector('.nav-toggle');
        toggleLink?.addEventListener('click', e => {
            e.preventDefault();
            mediaGroup.classList.toggle('open');
            // Clear subitem active states when toggling the group
            mediaGroup
                ?.querySelectorAll('.nav-subitem')
                ?.forEach(s => s.classList.remove('active'));
            // Show section and ONLY the overview (hide all source panels)
            const section = document.getElementById('section-media-sources');
            if (section) {
                const list = section.querySelectorAll('section.panel');
                list.forEach(p => (p.hidden = p.id !== 'panel-sources-overview'));
                dbg('nav-toggle click -> overview help shown');
            }
            showSection('section-media-sources');
            // Ensure configuration values are loaded once when opening the group
            try {
                window.admin2?.loadMediaSources?.();
            } catch (_) {
                // ignore
            }
        });
        // Show only the selected source panel
        function showSourcePanel(panelId, title) {
            // Ensure section is visible first
            showSection('section-media-sources');
            const section = document.getElementById('section-media-sources');
            if (!section) return;
            const list = section.querySelectorAll('section.panel');
            dbg('showSourcePanel()', { panelId, title, panels: list.length });
            // Put all panels into non-loading state first
            list.forEach(p => p.classList.remove('is-loading'));
            list.forEach(p => {
                if (
                    p.id === 'panel-plex' ||
                    p.id === 'panel-jellyfin' ||
                    p.id === 'panel-tmdb' ||
                    p.id === 'panel-tvdb'
                ) {
                    p.hidden = p.id !== panelId;
                } else {
                    p.hidden = true; // hide overview panel when selecting a specific source
                }
            });
            // Update header AFTER showSection so it doesn't overwrite
            const h1 = document.querySelector('.page-header h1');
            const subtitle = document.querySelector('.page-header p');
            if (h1) h1.innerHTML = `<i class="fas fa-server"></i> ${title}`;
            if (subtitle) subtitle.textContent = `Configure ${title} settings`;
            const el = document.getElementById(panelId);
            if (el) {
                // Force show defensively if some stylesheet keeps it hidden
                el.hidden = false;
                const cs = window.getComputedStyle(el);
                if (cs.display === 'none' || cs.visibility === 'hidden') {
                    el.style.display = 'block';
                    el.style.visibility = 'visible';
                }
                const content = el.querySelector('.panel-content');
                if (content) {
                    content.hidden = false;
                    const ccs = window.getComputedStyle(content);
                    if (ccs.display === 'none' || ccs.visibility === 'hidden') {
                        content.style.display = 'block';
                        content.style.visibility = 'visible';
                    }
                }
                dbg('panel visibility', {
                    id: panelId,
                    hidden: el.hidden,
                    display: cs.display,
                    visibility: cs.visibility,
                    contentHidden: content?.hidden,
                });
                // Always scroll the entire page to the absolute top when switching panels
                try {
                    // Primary: window scroll
                    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
                } catch (_) {
                    // no-op
                }
                try {
                    // Fallbacks for various scroll containers/browsers
                    document.documentElement.scrollTop = 0;
                    document.body.scrollTop = 0;
                    // Attempt common scroll containers just in case
                    const scrollers = document.querySelectorAll(
                        '.main, .content, .container, .layout, .page, .page-content, .content-wrapper, .scroll-container'
                    );
                    scrollers.forEach(s => {
                        if (s && typeof s.scrollTop === 'number') s.scrollTop = 0;
                    });
                } catch (_) {
                    // no-op
                }
                // Show loading overlay while we ensure config is populated
                el.classList.add('is-loading');
                // Ensure auto-fetch runs when panel becomes visible (covers all routes)
                try {
                    if (panelId === 'panel-plex') {
                        // Reset the auto-fetch flag so libraries are re-fetched each time panel opens
                        if (window.__autoFetchedLibs) window.__autoFetchedLibs.plex = false;
                        window.admin2?.maybeFetchPlexOnOpen?.();
                    } else if (panelId === 'panel-jellyfin') {
                        // Reset the auto-fetch flag so libraries are re-fetched each time panel opens
                        if (window.__autoFetchedLibs) window.__autoFetchedLibs.jf = false;
                        window.admin2?.maybeFetchJellyfinOnOpen?.();
                    } else if (panelId === 'panel-tmdb') window.admin2?.maybeFetchTmdbOnOpen?.();
                } catch (_) {
                    /* no-op */
                }
            } else {
                dbg('panel not found', { panelId });
            }
            // Kick off background init without blocking the panel UI spinner.
            // Some sources (e.g., Jellyfin) can be slow; don't keep Plex panel loading.
            try {
                const p = window.admin2?.loadMediaSources?.();
                if (p && typeof p.then === 'function') p.catch(() => {});
            } catch (_) {
                /* ignore */
            }
            // Always clear loading state shortly after making the panel visible
            setTimeout(() => {
                const active = document.getElementById(panelId);
                active?.classList.remove('is-loading');
                dbg('showSourcePanel() applied', { panelId, visible: !active?.hidden });
            }, 60);
        }

        mediaGroup?.querySelectorAll('.nav-subitem').forEach(sub => {
            sub.addEventListener('click', e => {
                e.preventDefault();
                document
                    .querySelectorAll('.sidebar-nav .nav-item')
                    .forEach(n => n.classList.remove('active'));
                // Mark group header and the clicked subitem as active
                toggleLink?.classList.add('active');
                mediaGroup?.classList.add('open');
                mediaGroup
                    ?.querySelectorAll('.nav-subitem')
                    .forEach(s => s.classList.remove('active'));
                sub.classList.add('active');
                const key = sub.getAttribute('data-sub');
                const map = {
                    plex: { id: 'panel-plex', title: 'Plex', hash: '#plex' },
                    jellyfin: { id: 'panel-jellyfin', title: 'Jellyfin', hash: '#jellyfin' },
                    tmdb: { id: 'panel-tmdb', title: 'TMDB', hash: '#tmdb' },
                    tvdb: { id: 'panel-tvdb', title: 'TVDB', hash: '#tvdb' },
                };
                const t = map[key] || map.plex;
                dbg('submenu click', { key, ...t });
                // Update URL hash for direct linking and routing
                if (location.hash !== t.hash) location.hash = t.hash;
                // Also show immediately to avoid any race conditions with routing
                showSourcePanel(t.id, t.title);
                // Lazy-load libraries when opening specific panels (non-blocking)
                if (t.id === 'panel-plex') window.admin2?.maybeFetchPlexOnOpen?.();
                else if (t.id === 'panel-jellyfin') window.admin2?.maybeFetchJellyfinOnOpen?.();
                else if (t.id === 'panel-tmdb') window.admin2?.maybeFetchTmdbOnOpen?.();
            });
        });

        // Lightweight hash router so /admin2.html#plex opens Plex panel.
        // On initial load, always show Dashboard regardless of hash.
        // Debounced router to avoid rapid flicker when switching fast
        let routeTimer = null;
        // Persist first-run across any accidental script re-executions to avoid bouncing to Dashboard
        let firstRoute = !window.__adminFirstRouteDone;
        // Preserve last route across hard reloads (fallback)
        try {
            const saved = sessionStorage.getItem('admin:lastRoute');
            if (!location.hash && saved && typeof saved === 'string') {
                const allowed = [
                    '#dashboard',
                    '#display',
                    '#operations',
                    '#devices',
                    '#media-sources',
                ];
                if (allowed.includes(saved)) {
                    history.replaceState(null, '', saved);
                }
            }
        } catch (_) {}
        function routeByHash() {
            if (routeTimer) {
                clearTimeout(routeTimer);
                routeTimer = null;
            }
            routeTimer = setTimeout(() => {
                routeTimer = null;
                // First-run: force Dashboard view and clear any hash
                if (firstRoute) {
                    firstRoute = false;
                    try {
                        window.__adminFirstRouteDone = true;
                    } catch (_) {
                        /* no-op */
                    }
                    try {
                        if (location.hash) {
                            // replaceState to avoid history entry
                            history.replaceState(null, '', location.pathname + location.search);
                        }
                    } catch (_) {
                        try {
                            // Fallback if History API fails
                            // eslint-disable-next-line no-self-assign
                            location.hash = '';
                        } catch (__) {
                            /* no-op */
                        }
                    }
                    // Activate dashboard section and nav item
                    showSection('section-dashboard');
                    document
                        .querySelectorAll('.sidebar-nav .nav-item')
                        .forEach(n => n.classList.remove('active'));
                    document
                        .querySelector('.sidebar-nav .nav-item[data-nav="dashboard"]')
                        ?.classList.add('active');
                    return;
                }
                const h = (location.hash || '').toLowerCase();
                // If user is already on Devices and hash doesn't target a source, keep Devices active
                try {
                    const devicesActive = document
                        .getElementById('section-devices')
                        ?.classList.contains('active');
                    if (
                        devicesActive &&
                        (!h ||
                            h === '#' ||
                            h === '#/' ||
                            h === '#media-sources' ||
                            h === '#media-sources/overview')
                    ) {
                        // Ensure Devices remains visible and skip default routing
                        showSection('section-devices');
                        return;
                    }
                } catch (_) {
                    /* ignore */
                }
                if (h === '#plex' || h === '#media-sources/plex') {
                    showSourcePanel('panel-plex', 'Plex');
                    // Lazy-load on routed open
                    window.admin2?.maybeFetchPlexOnOpen?.();
                    mediaGroup?.classList.add('open');
                    mediaGroup
                        ?.querySelectorAll('.nav-subitem')
                        ?.forEach(s => s.classList.remove('active'));
                    mediaGroup
                        ?.querySelector('.nav-subitem[data-sub="plex"]')
                        ?.classList.add('active');
                    return;
                }
                if (h === '#devices') {
                    showSection('section-devices');
                    try {
                        window.admin2?.initDevices?.();
                    } catch (_) {}
                    return;
                }
                if (h === '#jellyfin') {
                    showSourcePanel('panel-jellyfin', 'Jellyfin');
                    // Lazy-load on routed open
                    window.admin2?.maybeFetchJellyfinOnOpen?.();
                    mediaGroup?.classList.add('open');
                    mediaGroup
                        ?.querySelectorAll('.nav-subitem')
                        ?.forEach(s => s.classList.remove('active'));
                    mediaGroup
                        ?.querySelector('.nav-subitem[data-sub="jellyfin"]')
                        ?.classList.add('active');
                    return;
                }
                if (h === '#tmdb') {
                    showSourcePanel('panel-tmdb', 'TMDB');
                    // Lazy-load on routed open
                    window.admin2?.maybeFetchTmdbOnOpen?.();
                    mediaGroup?.classList.add('open');
                    mediaGroup
                        ?.querySelectorAll('.nav-subitem')
                        ?.forEach(s => s.classList.remove('active'));
                    mediaGroup
                        ?.querySelector('.nav-subitem[data-sub="tmdb"]')
                        ?.classList.add('active');
                    return;
                }
                if (h === '#tvdb') {
                    showSourcePanel('panel-tvdb', 'TVDB');
                    // Lazy-load on routed open
                    window.admin2?.maybeFetchTmdbOnOpen?.();
                    mediaGroup?.classList.add('open');
                    mediaGroup
                        ?.querySelectorAll('.nav-subitem')
                        ?.forEach(s => s.classList.remove('active'));
                    mediaGroup
                        ?.querySelector('.nav-subitem[data-sub="tvdb"]')
                        ?.classList.add('active');
                    return;
                }
                if (h === '#media-sources' || h === '#media-sources/overview') {
                    // Only show overview help panel
                    showSection('section-media-sources');
                    const section = document.getElementById('section-media-sources');
                    if (section) {
                        section
                            .querySelectorAll('section.panel')
                            .forEach(p => (p.hidden = p.id !== 'panel-sources-overview'));
                    }
                    // Update page title
                    const h1 = document.querySelector('.page-header h1');
                    const subtitle = document.querySelector('.page-header p');
                    if (h1) h1.innerHTML = '<i class="fas fa-server"></i> Media Sources';
                    if (subtitle)
                        subtitle.textContent = 'Overview and guidance for source configuration';
                    return;
                }
                // Default: keep current section or overview
            }, 60); // small debounce to smooth rapid clicks
        }
        window.addEventListener('hashchange', routeByHash);
        window.addEventListener('hashchange', () => {
            try {
                sessionStorage.setItem('admin:lastRoute', location.hash || '');
            } catch (_) {}
        });
        // Initial route on load
        try {
            sessionStorage.setItem('admin:lastRoute', location.hash || '');
        } catch (_) {}
        routeByHash();
        // If hash on load points to a top-level section (none currently), ensure submenu is cleared
        try {
            const h0 = (location.hash || '').toLowerCase();
            if (
                !h0.startsWith('#plex') &&
                !h0.startsWith('#jellyfin') &&
                !h0.startsWith('#tmdb') &&
                !h0.startsWith('#tvdb')
            ) {
                document
                    .querySelectorAll('.sidebar-nav .nav-subitem')
                    ?.forEach(s => s.classList.remove('active'));
            }
        } catch (_) {
            /* no-op */
        }

        // Security panel auto-refresh handled on nav; no manual refresh button

        // --- Admin fetch de-dupe + short-lived caching to avoid rate limiter bursts ---
        const inflight = new Map();
        const miniCache = new Map(); // key -> { ts, data, status }
        const MINI_TTL = 10 * 1000; // 10s
        window.dedupJSON = async function (url, opts = {}) {
            const key = `${url}|${opts.method || 'GET'}`;
            const now = Date.now();
            const cached = miniCache.get(key);
            if (cached && now - cached.ts < MINI_TTL) {
                return {
                    ok: cached.status >= 200 && cached.status < 300,
                    json: async () => cached.data,
                    status: cached.status,
                    fromCache: true,
                };
            }
            if (inflight.has(key)) return inflight.get(key);
            const p = (async () => {
                const res = await fetch(url, { credentials: 'include', ...opts });
                const status = res.status;
                // Try to parse JSON either way; some 202/4xx may still include JSON payload
                let data = null;
                try {
                    data = await res.json();
                } catch (_) {
                    data = null;
                }
                // Only cache successful 2xx responses; avoid caching 202-building or errors
                if (res.ok && status >= 200 && status < 300) {
                    miniCache.set(key, { ts: Date.now(), data, status });
                }
                return { ok: res.ok, json: async () => data, status };
            })()
                .catch(err => {
                    return { ok: false, status: 0, error: err };
                })
                .finally(() => inflight.delete(key));
            inflight.set(key, p);
            return p;
        };

        // helper: ensure button spinner exists
        const ensureSpinner = btn => {
            if (!btn) return;
            if (!btn.querySelector('.spinner')) {
                const sp = document.createElement('span');
                sp.className = 'spinner';
                btn.insertBefore(sp, btn.firstChild);
            }
        };

        // Security: change password
        const btnChangePw = document.getElementById('btn-change-password');
        ensureSpinner(btnChangePw);
        btnChangePw?.addEventListener('click', async () => {
            const cur = document.getElementById('sec-current-pw');
            const nw = document.getElementById('sec-new-pw');
            const conf = document.getElementById('sec-confirm-pw');
            const currentPassword = cur?.value || '';
            const newPassword = nw?.value || '';
            const confirmPassword = conf?.value || '';
            if (!currentPassword || !newPassword || !confirmPassword) {
                return window.notify?.toast({
                    type: 'warning',
                    title: 'Missing fields',
                    message: 'Please fill in all password fields',
                    duration: 3500,
                });
            }
            if (newPassword.length < 8) {
                return window.notify?.toast({
                    type: 'warning',
                    title: 'Weak password',
                    message: 'New password must be at least 8 characters',
                    duration: 3500,
                });
            }
            if (newPassword !== confirmPassword) {
                return window.notify?.toast({
                    type: 'warning',
                    title: 'Mismatch',
                    message: 'New password and confirmation do not match',
                    duration: 3500,
                });
            }
            try {
                btnChangePw.classList.add('btn-loading');
                const res = await fetch('/api/admin/change-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok)
                    throw new Error(data?.error || data?.message || 'Failed to change password');
                window.notify?.toast({
                    type: 'success',
                    title: 'Password changed',
                    message: 'You will need to log in again.',
                    duration: 4500,
                });
                setTimeout(() => {
                    location.href = '/admin/login';
                }, 1500);
            } catch (e) {
                window.notify?.toast({
                    type: 'error',
                    title: 'Change failed',
                    message: e?.message || 'Unable to change password',
                    duration: 5000,
                });
            } finally {
                btnChangePw.classList.remove('btn-loading');
            }
        });

        // Security: 2FA enable flow
        const btn2faEnable = document.getElementById('btn-2fa-enable');
        const btn2faDisable = document.getElementById('btn-2fa-disable');
        ensureSpinner(btn2faEnable);
        ensureSpinner(btn2faDisable);
        btn2faEnable?.addEventListener('click', async () => {
            try {
                btn2faEnable.classList.add('btn-loading');
                const r = await fetch('/api/admin/2fa/generate', {
                    method: 'POST',
                    credentials: 'include',
                });
                const j = await r.json().catch(() => ({}));
                if (!r.ok) throw new Error(j?.error || 'Failed to start 2FA setup');
                const qr = document.getElementById('qr-code-container');
                if (qr)
                    qr.innerHTML = j.qrCodeDataUrl
                        ? `<img src="${j.qrCodeDataUrl}" alt="Scan QR code" style="background:#fff;padding:8px;border-radius:8px;" />`
                        : '<span>QR unavailable</span>';
                openModal('modal-2fa');
            } catch (e) {
                window.notify?.toast({
                    type: 'error',
                    title: '2FA setup failed',
                    message: e?.message || 'Unable to generate QR code',
                    duration: 5000,
                });
            } finally {
                btn2faEnable.classList.remove('btn-loading');
            }
        });
        // Theme-demo modal close buttons just have data-close-modal and close nearest overlay
        document.querySelectorAll('[data-close-modal]')?.forEach(btn => {
            btn.addEventListener('click', () => {
                const overlay = btn.closest('.modal-overlay');
                if (overlay) overlay.classList.remove('open');
            });
        });
        const btn2faVerify = document.getElementById('btn-2fa-verify');
        const input2faToken = document.getElementById('input-2fa-token');

        // Auto-format 2FA token input (123 456 format)
        input2faToken?.addEventListener('input', e => {
            let value = String(e.target.value || '')
                .replace(/\D/g, '')
                .slice(0, 6);
            if (value.length > 3) value = value.slice(0, 3) + ' ' + value.slice(3);
            e.target.value = value;
            if (value.replace(/\s/g, '').length === 6) {
                btn2faVerify?.focus();
            }
        });

        // Allow Enter key to submit
        input2faToken?.addEventListener('keydown', e => {
            if (e.key === 'Enter' && input2faToken.value.replace(/\s/g, '').length === 6) {
                btn2faVerify?.click();
            }
        });

        ensureSpinner(btn2faVerify);
        btn2faVerify?.addEventListener('click', async () => {
            const input = document.getElementById('input-2fa-token');
            const token = (input?.value || '').replace(/\s/g, '').trim(); // Remove spaces
            if (!token || token.length !== 6) {
                return window.notify?.toast({
                    type: 'warning',
                    title: 'Invalid Code',
                    message: 'Enter the complete 6-digit code from your authenticator app',
                    duration: 3500,
                });
            }
            try {
                btn2faVerify.classList.add('btn-loading');
                btn2faVerify.disabled = true;
                const r = await fetch('/api/admin/2fa/verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ token }),
                });
                const j = await r.json().catch(() => ({}));
                if (!r.ok) throw new Error(j?.error || j?.message || 'Verification failed');
                window.notify?.toast({
                    type: 'success',
                    title: '2FA Enabled Successfully',
                    message: 'Two-Factor Authentication is now protecting your account.',
                    duration: 4000,
                });
                closeModal('modal-2fa');
                refreshSecurity();
            } catch (e) {
                window.notify?.toast({
                    type: 'error',
                    title: 'Verification Failed',
                    message: e?.message || 'Invalid or expired code. Please try again.',
                    duration: 5000,
                });
                // Clear input on error
                if (input) {
                    input.value = '';
                    input.focus();
                }
            } finally {
                btn2faVerify?.classList.remove('btn-loading');
                btn2faVerify.disabled = false;
            }
        });

        // Devices UI: initialize interactions when section is shown
        window.admin2 = window.admin2 || {};
        window.admin2.initDevices = function initDevices() {
            const section = document.getElementById('section-devices');
            if (!section) return;
            if (section.dataset.inited === '1') {
                dbg('initDevices(): already initialized');
                return;
            }
            dbg('initDevices(): starting');
            const grid = document.getElementById('device-grid');
            const deviceSearch = document.getElementById('device-search');
            const pageInfo = document.getElementById('device-page-info');
            const pageNumbers = document.getElementById('device-page-numbers');
            const pagePrev = document.getElementById('device-page-prev');
            const pageNext = document.getElementById('device-page-next');
            const perPageSel = document.getElementById('device-per-page');
            const mergeSource = document.getElementById('merge-source');
            const mergeTarget = document.getElementById('merge-target');
            const mergeConfirm = document.getElementById('btn-merge-confirm');
            const bulkBar = document.getElementById('bulk-bar');
            const bulkCount = document.getElementById('bulk-count');

            const state = {
                all: [],
                filteredIds: [],
                currentPage: 1,
                perPage: perPageSel ? parseInt(perPageSel.value, 10) : 9,
                query: '',
                filterStatus: null,
                filterRoom: null,
                presets: [],
                groups: [],
                syncEnabled: undefined, // loaded from /get-config
            };
            // Persist UI pin toggles so they survive reloads; merge with server state
            const PIN_STORE_KEY = 'admin2:pinned-devices';
            const loadPinnedMap = () => {
                try {
                    const raw = localStorage.getItem(PIN_STORE_KEY);
                    const obj = raw ? JSON.parse(raw) : {};
                    return obj && typeof obj === 'object' ? obj : {};
                } catch (_) {
                    return {};
                }
            };
            let pinnedUI = loadPinnedMap();
            const savePinnedMap = () => {
                try {
                    localStorage.setItem(PIN_STORE_KEY, JSON.stringify(pinnedUI));
                } catch (_) {}
            };
            // Expose minimal debug hooks
            try {
                window.admin2 = window.admin2 || {};
                window.admin2.devicesDebug = {
                    get state() {
                        return state;
                    },
                    reload: () => loadDevices(),
                    render: () => renderPage(),
                };
            } catch (_) {}

            const slugify = s =>
                String(s || '')
                    .trim()
                    .toLowerCase()
                    .replace(/\s+/g, '-')
                    .replace(/[^a-z0-9-]/g, '');

            function getStatusClass(d) {
                const st = String(d?.status || '').toLowerCase();
                // 1) Live when a WebSocket is connected
                if (d?.wsConnected) return 'live';

                // 2) If we haven't seen the device recently, consider it offline
                //    Frontend safeguard so stale "online" doesn't linger when lastSeenAt is old
                const lastTs = Date.parse(d?.lastSeenAt || 0) || 0;
                const now = Date.now();
                const STALE_OFFLINE_MS = 60 * 60 * 1000; // 1 hour
                if (!lastTs) return 'unknown';
                if (now - lastTs > STALE_OFFLINE_MS) return 'offline';

                // 3) Otherwise reflect server status string (online/unknown)
                if (st === 'live') return 'live';
                if (st === 'online') return 'online';
                if (st === 'unknown') return 'unknown';
                return 'offline';
            }
            function iconForStatus(status) {
                switch (String(status || '').toLowerCase()) {
                    case 'live':
                        return 'fas fa-bolt';
                    case 'online':
                        return 'fas fa-signal';
                    case 'offline':
                        return 'fas fa-plug-circle-xmark';
                    default:
                        return 'fas fa-question-circle';
                }
            }
            function iconForDevice(d) {
                const ua = String(d?.clientInfo?.userAgent || '').toLowerCase();
                if (/android|tv/.test(ua)) return 'fa-tv';
                if (/ipad|tablet/.test(ua)) return 'fa-tablet';
                if (/mobile|iphone|android/.test(ua)) return 'fa-mobile-screen';
                if (/windows|mac|linux|chrome|safari|firefox/.test(ua)) return 'fa-desktop';
                return 'fa-display';
            }
            function typeLabel(d) {
                const ua = String(d?.clientInfo?.userAgent || '');
                if (/Android TV/i.test(ua)) return 'Android TV';
                if (/Android/i.test(ua)) return 'Android';
                if (/iPhone|iPad|iOS/i.test(ua)) return 'iOS';
                if (/Chrome/i.test(ua)) return 'Chrome';
                if (/Safari/i.test(ua)) return 'Safari';
                if (/Firefox/i.test(ua)) return 'Firefox';
                if (/Windows/i.test(ua)) return 'Windows';
                if (/Mac OS|Macintosh/i.test(ua)) return 'macOS';
                return 'Browser';
            }
            function isDevicePinned(d) {
                if (!d) return false;
                // Display must ALWAYS reflect what the client reports via server state.
                const cs = d.currentState || {};
                const serverPinned =
                    cs.pinned === true ||
                    cs.pin === true ||
                    (cs.pinMediaId != null && cs.pinMediaId !== '');
                return !!serverPinned;
            }
            function iconForType(type) {
                const t = String(type || '').toLowerCase();
                if (t.includes('android tv')) return 'fas fa-tv';
                if (t === 'android') return 'fab fa-android';
                if (t === 'ios') return 'fab fa-apple';
                if (t === 'chrome') return 'fab fa-chrome';
                if (t === 'safari') return 'fab fa-safari';
                if (t === 'firefox') return 'fab fa-firefox-browser';
                if (t === 'windows') return 'fab fa-windows';
                if (t === 'macos') return 'fab fa-apple';
                if (t === 'browser') return 'fas fa-globe';
                return 'fas fa-display';
            }
            function modeLabel(mode) {
                const m = String(mode || '').toLowerCase();
                if (m === 'screensaver') return 'Screensaver';
                if (m === 'wallart') return 'Wallart';
                if (m === 'cinema') return 'Cinema';
                return '';
            }
            function iconForMode(mode) {
                const m = String(mode || '').toLowerCase();
                if (m === 'screensaver') return 'fas fa-moon';
                if (m === 'wallart') return 'fas fa-images';
                if (m === 'cinema') return 'fas fa-tv';
                return 'fas fa-circle';
            }
            function roomLabel(d) {
                return d.location ? d.location : 'Unassigned';
            }
            function versionMeta(d) {
                // Only show app version; hide user agent details
                const appVer = d?.clientInfo?.appVersion || d?.clientInfo?.version || '';
                return appVer ? `v${appVer}` : '';
            }
            // Resolution helpers -> render using theme-demo badge styles
            function getScreen(d) {
                const sc = d?.clientInfo?.screen || {};
                const w = Number(sc.w || sc.width || 0) || 0;
                const h = Number(sc.h || sc.height || 0) || 0;
                const dpr = Number(sc.dpr || sc.scale || 1) || 1;
                return { w, h, dpr, raw: sc };
            }
            function resolutionTier(d) {
                const { w, h } = getScreen(d);
                if (!w || !h) return null;
                const maxSide = Math.max(w, h);
                if (maxSide >= 7680) return { key: '8K' };
                if (maxSide >= 3840) return { key: '4K' };
                if (maxSide >= 2560) return { key: '1440p' }; // QHD
                if (maxSide >= 1920) return { key: '1080p' };
                if (maxSide >= 1280) return { key: '720p' };
                return { key: 'SD' };
            }
            function resolutionIcon(d) {
                const { w, h, dpr } = getScreen(d);
                const tier = resolutionTier(d);
                if (!tier) return '';
                const label = tier.key;
                const title = `${w}×${h}${dpr && dpr !== 1 ? ` @${dpr}x` : ''}`;
                const cls = (lbl => {
                    switch (lbl) {
                        case '8K':
                            return 'badge-premium'; // gold gradient – stands out
                        case '4K':
                            return 'badge-premium'; // gold gradient – stands out
                        case '1440p':
                            return 'badge-pro'; // purple gradient
                        case '1080p':
                            return 'badge-success'; // green gradient
                        case '720p':
                            return 'badge-primary'; // primary gradient
                        case 'SD':
                        default:
                            return 'badge-secondary'; // gray gradient
                    }
                })(label);
                return `<span class="badge ${cls}" title="${escapeHtml(title)}">${escapeHtml(label)}</span>`;
            }
            // Duplicate detection (hardwareId, installId, UA+screen)
            function uaScKey(d) {
                try {
                    const ci = d && d.clientInfo ? d.clientInfo : {};
                    const ua = (ci.userAgent || ci.ua || '').trim();
                    const sc = ci.screen || {};
                    const w = Number(sc.w || sc.width || 0) || 0;
                    const h = Number(sc.h || sc.height || 0) || 0;
                    const dpr = Number(sc.dpr || sc.scale || 1) || 1;
                    if (!ua || !w || !h) return '';
                    return `${ua}|${w}x${h}@${dpr}x`;
                } catch (_) {
                    return '';
                }
            }
            function computeDupMaps() {
                const hwMap = Object.create(null);
                const iidMap = Object.create(null);
                const uaScMap = Object.create(null);
                const list = (state.filteredIds || [])
                    .map(id => state.all.find(x => x.id === id))
                    .filter(Boolean);
                try {
                    list.forEach(d => {
                        const hw = d && d.hardwareId;
                        if (hw) (hwMap[hw] = hwMap[hw] || []).push(d);
                        const iid = d && d.installId;
                        if (iid) (iidMap[iid] = iidMap[iid] || []).push(d);
                        const key = uaScKey(d);
                        if (key) (uaScMap[key] = uaScMap[key] || []).push(d);
                    });
                } catch (_) {}
                state.dupMaps = { hwMap, iidMap, uaScMap };
            }
            function getDupesForDevice(d) {
                const maps = state.dupMaps || {};
                const { hwMap = {}, iidMap = {}, uaScMap = {} } = maps;
                const reasonsById = Object.create(null);
                const add = (x, reason) => {
                    if (!x || x.id === d.id) return;
                    const entry = reasonsById[x.id] || { dev: x, reasons: new Set() };
                    entry.reasons.add(reason);
                    reasonsById[x.id] = entry;
                };
                try {
                    if (d.hardwareId && hwMap[d.hardwareId] && hwMap[d.hardwareId].length > 1) {
                        for (const x of hwMap[d.hardwareId]) add(x, 'hardwareId');
                    }
                    if (d.installId && iidMap[d.installId] && iidMap[d.installId].length > 1) {
                        for (const x of iidMap[d.installId]) add(x, 'installId');
                    }
                    const key = uaScKey(d);
                    if (key && uaScMap[key] && uaScMap[key].length > 1) {
                        for (const x of uaScMap[key]) add(x, 'UA+screen');
                    }
                } catch (_) {}
                return Object.values(reasonsById).map(v => ({
                    dev: v.dev,
                    reasons: Array.from(v.reasons),
                }));
            }
            function renderCard(d) {
                const status = getStatusClass(d);
                const icon = iconForDevice(d);
                const type = typeLabel(d);
                const mode = d?.clientInfo?.mode || d?.mode || '';
                const room = roomLabel(d);
                const meta = versionMeta(d);
                const disabledPower = status === 'offline' ? ' disabled' : '';
                const isPoweredOff = d?.currentState?.poweredOff === true;
                const poweredOff = isPoweredOff ? ' title="Currently powered off"' : '';
                const statusLabel =
                    status === 'live'
                        ? isPoweredOff
                            ? 'Powered off'
                            : 'Live'
                        : status === 'online'
                          ? 'Online'
                          : status === 'unknown'
                            ? 'Unknown'
                            : 'Offline';
                const dupeList = getDupesForDevice(d);
                const dupesPill = (() => {
                    if (!dupeList || !dupeList.length) return '';
                    const listIds = dupeList.map(x => x.dev && x.dev.id).filter(Boolean);
                    const tipList = dupeList
                        .map(x => {
                            const nm =
                                (x.dev && x.dev.name ? String(x.dev.name).slice(0, 40) : '') ||
                                (x.dev && x.dev.id ? x.dev.id.slice(0, 8) : '(unnamed)');
                            const sid = (x.dev && x.dev.id ? x.dev.id : '').slice(0, 8);
                            const rsn =
                                x.reasons && x.reasons.length ? ` [${x.reasons.join(', ')}]` : '';
                            return `${nm} — ${sid}${rsn}`;
                        })
                        .join('\n');
                    const title = `Likely duplicates (reasons per item):\n${tipList}`;
                    const safeTitle = title.replace(/"/g, '&quot;');
                    const safeIds = listIds.join(',').replace(/"/g, '&quot;');
                    return `<span class="pill pill-dup js-dupes-hover" title="${safeTitle}" data-dupes-ids="${safeIds}" data-dupes-title="${safeTitle}"><i class="fas fa-clone"></i> Dupes: ${dupeList.length}</span>`;
                })();
                // Map preset and groups to human-readable labels
                const presetKey = (d && typeof d.preset === 'string' ? d.preset : '').trim();
                const presetName = presetKey
                    ? state.presets.find(p => p.key === presetKey)?.name || presetKey
                    : '';
                const groupNames = Array.isArray(d?.groups)
                    ? d.groups
                          .map(gid => {
                              const g = (state.groups || []).find(
                                  x => x.id === gid || x.key === gid
                              );
                              return g?.name || gid;
                          })
                          .filter(Boolean)
                    : [];
                // Playback state helpers for toolbar play/pause button
                const pausedFlag = d?.currentState?.paused;
                const ppCls = pausedFlag === true ? ' is-paused' : ' is-playing';
                // Icon represents STATE (not action):
                // - playing => play icon (gray)
                // - paused  => pause icon (yellow)
                const ppIcon = pausedFlag === true ? 'fa-pause' : /* paused */ 'fa-play';
                const ppTitle = pausedFlag === true ? 'Resume' : 'Pause';
                // Pin button initial state
                const initiallyPinned = isDevicePinned(d);
                const pinCls = initiallyPinned ? ' is-pinned' : '';
                const pinIcon = initiallyPinned ? 'fa-map-pin' : 'fa-thumbtack';
                const pinTitle = initiallyPinned ? 'Unpin poster' : 'Pin current poster';
                const pinPressed = initiallyPinned ? 'true' : 'false';
                return `
                                <div class="device-card${dupeList && dupeList.length ? ' has-dupes' : ''}" data-id="${d.id}" data-status="${status}" data-room="${(room || '').toLowerCase().replace(/\s+/g, '-')}" data-dupes-count="${dupeList ? dupeList.length : 0}">
                                    ${d.wsConnected && state.syncEnabled !== false ? '<div class="device-corner"><span class="synced-dot" role="status" aria-label="Device will align to sync ticks" title="Device will align to sync ticks"></span></div>' : ''}
                                                                        <div class="device-card-header">
                                                                                <div class="device-select-wrap">
                                                                                        <label class="checkbox" aria-label="Select device: ${escapeHtml(d.name || d.id)}">
                                                                                                <input type="checkbox" class="device-select">
                                                                                                <span class="checkmark"></span>
                                                                                        </label>
                                                                                </div>
                                        <div class="device-id">
                                            <div class="device-avatar"><i class="fas ${icon}"></i></div>
                                            <div class="device-title">
                                                <div class="name-row">
                                                    <span class="name">${escapeHtml(d.name || 'Unnamed')}</span>
                                                    <button class="btn btn-icon btn-xxs btn-rename-inline" title="Rename device"><i class="fas fa-pen"></i></button>
                                                </div>
                                                <span class="meta">${escapeHtml(meta)}</span>
                                            </div>
                                        </div>
                                        <div class="device-res">${resolutionIcon(d)}</div>
                                    </div>

                                    <div class="device-tools">
                                                <button type="button" class="btn btn-icon btn-sm btn-power${isPoweredOff ? ' is-off' : ''}" title="Power Toggle"${disabledPower}${poweredOff}><i class="fas fa-power-off"></i></button>
                                                <button type="button" class="btn btn-icon btn-sm btn-reload" title="Reload this device"><i class="fas fa-rotate-right"></i></button>
                                                <button type="button" class="btn btn-icon btn-sm btn-clearcache" title="Clear caches"><i class="fas fa-broom"></i></button>
                                                <button type="button" class="btn btn-icon btn-sm btn-pair card-secondary" title="Generate pairing code"><i class="fas fa-qrcode"></i></button>
                                                <button type="button" class="btn btn-icon btn-sm btn-remote card-secondary" title="Open remote control" ${status === 'offline' || isPoweredOff ? 'disabled' : ''}><i class="fas fa-gamepad"></i></button>
                                                <button type="button" class="btn btn-icon btn-sm btn-override card-secondary" title="Edit display settings override"><i class="fas fa-sliders"></i></button>
                                                <button type="button" class="btn btn-icon btn-sm btn-sendcmd card-secondary" title="Send command" ${status === 'offline' || isPoweredOff ? 'disabled' : ''}><i class="fas fa-terminal"></i></button>
                                                <button type="button" class="btn btn-icon btn-sm btn-playpause${ppCls}" title="${ppTitle}" ${status === 'offline' || isPoweredOff ? 'disabled' : ''}><i class="fas ${ppIcon}"></i></button>
                                                <button type="button" class="btn btn-icon btn-sm btn-pin card-secondary${pinCls}" title="${pinTitle}" aria-pressed="${pinPressed}" ${status === 'offline' || isPoweredOff ? 'disabled' : ''}><i class="fas ${pinIcon}"></i></button>
                                                <div class="dropdown card-more" style="position:relative;display:none;">
                                                        <button class="btn btn-icon btn-sm" title="More"><i class="fas fa-ellipsis"></i></button>
                                                        <div class="dropdown-menu"></div>
                                                </div>
                                    </div>

                                    <div class="device-card-body">
                              <div class="device-badges">
                                            <span class="status-pill status-${status} js-status-hover" tabindex="0">
                                                <i class="${iconForStatus(isPoweredOff && status === 'live' ? 'offline' : status)}"></i> ${statusLabel}
                                            </span>
                                                          <span class="status-pill sp-browser"><i class="${iconForType(type)}"></i> ${escapeHtml(type)}</span>
                                                          ${dupesPill}
                                                          
                                                                                      ${(() => {
                                                                                          const m =
                                                                                              String(
                                                                                                  mode ||
                                                                                                      ''
                                                                                              ).toLowerCase();
                                                                                          const mClass =
                                                                                              m ===
                                                                                              'screensaver'
                                                                                                  ? 'pill-screensaver'
                                                                                                  : m ===
                                                                                                      'wallart'
                                                                                                    ? 'pill-wallart'
                                                                                                    : m ===
                                                                                                            'cinema' ||
                                                                                                        m ===
                                                                                                            'cinema mode'
                                                                                                      ? 'pill-cinema'
                                                                                                      : 'pill-mode';
                                                                                          return modeLabel(
                                                                                              mode
                                                                                          )
                                                                                              ? `<span class="status-pill ${mClass.replace('pill-', 'sp-')}"><i class="${iconForMode(mode)}"></i> ${escapeHtml(modeLabel(mode))}</span>`
                                                                                              : '';
                                                                                      })()}
                                                                                     
                                                                                </div>
                                        <div class="pill-grid">
                                            ${Number.isFinite(Number(d?.currentState?.rating)) ? `<span class="pill pill-rating">${Number(d.currentState.rating).toFixed(1)}</span>` : ''}
                                        </div>
                                    </div>
                                    <div class="device-actions">
                                        <div class="meta-pills" style="display:flex; gap:6px; flex-wrap:wrap;">
                                            <span class="status-pill" title="Location"><i class="fas fa-location-dot"></i> ${escapeHtml(room)}</span>
                                            ${presetName ? `<span class="status-pill" title="Preset"><i class="fas fa-star"></i> ${escapeHtml(presetName)}</span>` : ''}
                                            ${groupNames.length ? `<span class="status-pill" title="Groups"><i class="fas fa-layer-group"></i> ${escapeHtml(groupNames.join(', '))}</span>` : ''}
                                        </div>
                                    </div>
                </div>`;
            }
            function escapeHtml(s) {
                return String(s || '')
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#039;');
            }
            // Collapse secondary per-card actions into a kebab menu when space is tight
            function collapseCardActions(card) {
                try {
                    const row = card.querySelector('.device-tools');
                    const moreWrap = card.querySelector('.card-more');
                    if (!row || !moreWrap) return;
                    const moreBtn = moreWrap.querySelector('button');
                    const menu = moreWrap.querySelector('.dropdown-menu');
                    if (!moreBtn || !menu) return;
                    const secondary = Array.from(row.querySelectorAll('.card-secondary'));
                    if (!secondary.length) return;
                    // Determine if actions overflow the row; be slightly conservative to avoid wrap
                    const rowOverflow = row.scrollWidth - row.clientWidth > 2;
                    // Collapse only on real overflow AND very small screens; otherwise allow wrapping
                    const tooNarrow = rowOverflow && window.innerWidth < 640;
                    if (tooNarrow) {
                        // Build menu items for hidden actions (use button titles)
                        menu.innerHTML = secondary
                            .map(
                                (btn, idx) =>
                                    `<div class="dropdown-item" data-card-idx="${idx}">${btn.title || btn.getAttribute('aria-label') || 'Action'}</div>`
                            )
                            .join('');
                        // Hide secondary buttons and show kebab
                        secondary.forEach(btn => (btn.style.display = 'none'));
                        moreWrap.style.display = 'inline-block';
                        // Attach click proxy once
                        if (!moreWrap._menuWired) {
                            moreWrap._menuWired = true;
                            moreBtn?.addEventListener('click', e => {
                                e.stopPropagation();
                                const open = menu.style.display === 'block';
                                menu.style.display = open ? 'none' : 'block';
                                if (!open) {
                                    // Position the dropdown relative to viewport
                                    const r = moreBtn.getBoundingClientRect();
                                    menu.style.position = 'fixed';
                                    menu.style.top = `${r.bottom + 6}px`;
                                    // Try aligning right edge roughly
                                    const left = Math.max(
                                        8,
                                        Math.min(window.innerWidth - 228, r.right - 200)
                                    );
                                    menu.style.left = `${left}px`;
                                    menu.style.zIndex = 1701; // above hovercards
                                }
                            });
                            document.addEventListener('click', ev => {
                                if (!menu.contains(ev.target) && ev.target !== moreBtn)
                                    menu.style.display = 'none';
                            });
                            // Basic keyboard support for accessibility
                            menu.addEventListener('keydown', e => {
                                if (e.key === 'Escape') {
                                    menu.style.display = 'none';
                                    moreBtn.focus();
                                }
                            });
                            menu.addEventListener('click', ev => {
                                const item = ev.target.closest('.dropdown-item');
                                if (!item) return;
                                const idx = Number(item.getAttribute('data-card-idx'));
                                // Use the latest snapshot of hidden buttons
                                const list = moreWrap._secondary || secondary;
                                const target = list && list[idx];
                                if (target) {
                                    target.click();
                                }
                                menu.style.display = 'none';
                            });
                        }
                        // Store current secondary reference for this menu scope (refresh each time)
                        moreWrap._secondary = secondary;
                    } else {
                        // Restore inline buttons and hide kebab
                        secondary.forEach(btn => (btn.style.display = ''));
                        menu.innerHTML = '';
                        if (menu.style.display !== 'none') menu.style.display = 'none';
                        moreWrap.style.display = 'none';
                    }
                } catch (_) {
                    /* noop */
                }
            }

            function bindCardEvents(card) {
                const cb = card.querySelector('.device-select');
                cb?.addEventListener('change', e => {
                    try {
                        e.stopPropagation();
                    } catch (_) {}
                    card.classList.toggle('selected', cb.checked);
                    updateBulkUI();
                });
                card.querySelector('.btn-power')?.addEventListener('click', async e => {
                    try {
                        e.preventDefault();
                        e.stopPropagation();
                    } catch (_) {}
                    const id = card.getAttribute('data-id');
                    await sendCommand(id, 'power.toggle');
                });
                card.querySelector('.btn-reload')?.addEventListener('click', async e => {
                    try {
                        e.preventDefault();
                        e.stopPropagation();
                    } catch (_) {}
                    const id = card.getAttribute('data-id');
                    // Suppress SW update toasts briefly around action
                    try {
                        window.__suppressSwUpdateToasts = true;
                        setTimeout(() => (window.__suppressSwUpdateToasts = false), 8000);
                    } catch (_) {}
                    // one-time spin animation on the icon
                    try {
                        const icon = card.querySelector('.btn-reload i');
                        if (icon) {
                            icon.classList.remove('icon-spin-once');
                            // force reflow to restart animation if already applied
                            void icon.offsetWidth;
                            icon.classList.add('icon-spin-once');
                        }
                    } catch (_) {}
                    await sendCommand(id, 'core.mgmt.reload');
                    // Keep hash neutral to avoid router reactions
                    try {
                        if (location.hash && location.hash !== '#devices')
                            location.hash = '#devices';
                    } catch (_) {}
                    window.notify?.toast({
                        type: 'info',
                        title: 'Reload',
                        message: `${state.all.find(d => d.id === id)?.name || id}: reloading`,
                    });
                });
                card.querySelector('.btn-clearcache')?.addEventListener('click', async e => {
                    try {
                        e.preventDefault();
                        e.stopPropagation();
                    } catch (_) {}
                    const id = card.getAttribute('data-id');
                    // Suppress SW update toasts briefly around action
                    try {
                        window.__suppressSwUpdateToasts = true;
                        setTimeout(() => (window.__suppressSwUpdateToasts = false), 8000);
                    } catch (_) {}
                    // broom sweep animation
                    try {
                        const icon = card.querySelector('.btn-clearcache i');
                        if (icon) {
                            icon.classList.remove('broom-sweep');
                            void icon.offsetWidth; // restart
                            icon.classList.add('broom-sweep');
                        }
                    } catch (_) {}
                    await sendCommand(id, 'core.mgmt.clearCache');
                    // Keep hash neutral to avoid router reactions
                    try {
                        if (location.hash && location.hash !== '#devices')
                            location.hash = '#devices';
                    } catch (_) {}
                    window.notify?.toast({
                        type: 'success',
                        title: 'Clear cache',
                        message: `${state.all.find(d => d.id === id)?.name || id}: cache cleared`,
                    });
                });
                card.querySelector('.btn-pair')?.addEventListener('click', async e => {
                    try {
                        e.preventDefault();
                        e.stopPropagation();
                    } catch (_) {}
                    const id = card.getAttribute('data-id');
                    await openPairingFor([id]);
                });
                card.querySelector('.btn-remote')?.addEventListener('click', async e => {
                    try {
                        e.preventDefault();
                        e.stopPropagation();
                    } catch (_) {}
                    const id = card.getAttribute('data-id');
                    openRemoteFor(id);
                });
                card.querySelector('.btn-override')?.addEventListener('click', async e => {
                    try {
                        e.preventDefault();
                        e.stopPropagation();
                    } catch (_) {}
                    const id = card.getAttribute('data-id');
                    openOverrideFor([id]);
                });
                card.querySelector('.btn-sendcmd')?.addEventListener('click', async e => {
                    try {
                        e.preventDefault();
                        e.stopPropagation();
                    } catch (_) {}
                    const id = card.getAttribute('data-id');
                    openSendCmdFor([id]);
                });
                card.querySelector('.btn-playpause')?.addEventListener('click', async e => {
                    try {
                        e.preventDefault();
                        e.stopPropagation();
                    } catch (_) {}
                    const id = card.getAttribute('data-id');
                    const btn = card.querySelector('.btn-playpause');
                    const icon = btn?.querySelector('i');
                    // Optimistic UI toggle
                    if (btn) {
                        const wasPaused = btn.classList.contains('is-paused');
                        btn.classList.toggle('is-paused', !wasPaused);
                        btn.classList.toggle('is-playing', wasPaused);
                        // New icon semantics: represent STATE
                        // nowPaused => show pause icon; nowPlaying => show play icon
                        const nowPaused = !wasPaused;
                        if (icon) icon.className = `fas ${nowPaused ? 'fa-pause' : 'fa-play'}`;
                        // Title can reflect next action when clicked
                        btn.title = nowPaused ? 'Resume' : 'Pause';
                    }
                    try {
                        await sendCommand(id, 'playback.toggle');
                        // Attempt to update local device state if present
                        const dev = state.all.find(d => d.id === id);
                        if (dev) {
                            dev.currentState = dev.currentState || {};
                            const nowPaused = btn?.classList.contains('is-paused');
                            dev.currentState.paused = nowPaused;
                        }
                    } catch (_) {
                        // revert optimistic change on failure
                        if (btn) {
                            const nowPaused = btn.classList.contains('is-paused');
                            const revertToPaused = !nowPaused; // revert to previous
                            btn.classList.toggle('is-paused', revertToPaused);
                            btn.classList.toggle('is-playing', !revertToPaused);
                            // Re-apply icon reflecting the (reverted) STATE
                            if (icon)
                                icon.className = `fas ${revertToPaused ? 'fa-pause' : 'fa-play'}`;
                            // Title reflects the next action
                            btn.title = revertToPaused ? 'Resume' : 'Pause';
                        }
                    }
                });
                card.querySelector('.btn-pin')?.addEventListener('click', async e => {
                    try {
                        e.preventDefault();
                        e.stopPropagation();
                    } catch (_) {}
                    const id = card.getAttribute('data-id');
                    const btn = card.querySelector('.btn-pin');
                    const icon = btn?.querySelector('i');
                    const wasPinned = !!btn?.classList.contains('is-pinned');
                    // optimistic UI: toggle pinned state and aria-pressed immediately
                    if (btn) {
                        btn.classList.toggle('is-pinned', !wasPinned);
                        const pressed = !wasPinned;
                        btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
                        if (icon) {
                            icon.className = pressed ? 'fas fa-map-pin' : 'fas fa-thumbtack';
                        }
                        btn.title = pressed ? 'Unpin poster' : 'Pin current poster';
                    }
                    try {
                        const cmd = wasPinned ? 'playback.resume' : 'playback.pinPoster';
                        await sendCommand(id, cmd);
                        // Update local maps and in-memory state
                        if (wasPinned) {
                            if (pinnedUI && pinnedUI[id]) delete pinnedUI[id];
                            savePinnedMap();
                            const dev = state.all.find(d => d.id === id);
                            if (dev) {
                                dev.currentState = dev.currentState || {};
                                dev.currentState.pinned = false;
                                // Use empty string to explicitly signal cleared pin to server/UI
                                dev.currentState.pinMediaId = '';
                            }
                        } else {
                            pinnedUI = pinnedUI || {};
                            pinnedUI[id] = true;
                            savePinnedMap();
                            const dev = state.all.find(d => d.id === id);
                            if (dev) {
                                dev.currentState = dev.currentState || {};
                                dev.currentState.pinned = true;
                            }
                        }
                    } catch (_) {
                        // revert on failure
                        if (btn) {
                            btn.classList.toggle('is-pinned', wasPinned);
                            const pressed = wasPinned;
                            btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
                            if (icon) {
                                icon.className = pressed ? 'fas fa-map-pin' : 'fas fa-thumbtack';
                            }
                            btn.title = pressed ? 'Unpin poster' : 'Pin current poster';
                        }
                    }
                });
                // Support both inline header pencil and legacy rename button
                const renameBtn = card.querySelector('.btn-rename, .btn-rename-inline');
                renameBtn?.addEventListener('click', e => {
                    try {
                        e.preventDefault();
                        e.stopPropagation();
                    } catch (_) {}
                    startRename(card);
                });
                // per-card merge/group buttons removed; actions available via toolbar
                // Ensure action row collapses when width is tight
                collapseCardActions(card);
            }
            function startRename(card) {
                try {
                    const id = card.getAttribute('data-id');
                    const nameEl = card.querySelector('.device-title .name');
                    if (!nameEl || nameEl.dataset.editing === '1') return;
                    const current = nameEl.textContent || '';
                    nameEl.dataset.editing = '1';
                    const input = document.createElement('input');
                    input.type = 'text';
                    input.value = current;
                    input.className = 'inline-rename-input';
                    // styling handled in theme CSS (.inline-rename-input)
                    const finish = async commit => {
                        nameEl.dataset.editing = '';
                        nameEl.style.display = '';
                        input.remove();
                        if (!commit) return;
                        const val = (input.value || '').trim();
                        if (!val || val === current) return;
                        try {
                            await fetchJSON(`/api/devices/${encodeURIComponent(id)}`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ name: val }),
                            });
                            nameEl.textContent = val;
                            window.notify?.toast({
                                type: 'success',
                                title: 'Renamed',
                                message: 'Device name updated',
                            });
                        } catch (e) {
                            window.notify?.toast({
                                type: 'error',
                                title: 'Rename failed',
                                message: e?.message || 'Could not update device',
                            });
                        }
                    };
                    nameEl.style.display = 'none';
                    nameEl.parentElement.insertBefore(input, nameEl);
                    input.focus();
                    input.select();
                    input.addEventListener('keydown', ev => {
                        if (ev.key === 'Enter') finish(true);
                        else if (ev.key === 'Escape') finish(false);
                    });
                    input.addEventListener('blur', () => finish(true));
                } catch (_) {
                    /* ignore */
                }
            }
            function updateBulkUI() {
                const selected = document.querySelectorAll(
                    '#device-grid .device-card.selected'
                ).length;
                if (bulkCount) bulkCount.textContent = String(selected);
                if (bulkBar) bulkBar.classList.toggle('open', selected > 0);
                // Responsive controls: collapse secondary buttons on narrow widths
                try {
                    const bar = document.getElementById('bulk-bar');
                    const more = document.getElementById('bulk-more');
                    const menu = document.getElementById('bulk-more-menu');
                    if (bar && more && menu) {
                        const tooNarrow = bar.clientWidth < 760; // heuristic
                        const secs = Array.from(bar.querySelectorAll('.bulk-secondary'));
                        if (tooNarrow) {
                            // move secondary buttons into dropdown menu
                            menu.innerHTML = secs
                                .map(
                                    btn =>
                                        `<div class="dropdown-item" data-bulk-proxy="#${btn.id}">${btn.title}</div>`
                                )
                                .join('');
                            secs.forEach(btn => (btn.style.display = 'none'));
                            more.parentElement.style.display = 'inline-block';
                        } else {
                            secs.forEach(btn => (btn.style.display = ''));
                            more.parentElement.style.display = 'none';
                            menu.innerHTML = '';
                        }
                        more.onclick = () => {
                            const open = menu.style.display === 'block';
                            menu.style.display = open ? 'none' : 'block';
                            if (!open) {
                                // position below button
                                const r = more.getBoundingClientRect();
                                menu.style.position = 'fixed';
                                menu.style.top = `${r.bottom + 6}px`;
                                menu.style.left = `${Math.max(8, r.left - 120)}px`;
                                menu.style.zIndex = 3002;
                            }
                        };
                        document.addEventListener('click', e => {
                            if (!menu.contains(e.target) && e.target !== more)
                                menu.style.display = 'none';
                        });
                        menu.onclick = e => {
                            const item = e.target.closest('.dropdown-item');
                            if (!item) return;
                            const targetSel = item.getAttribute('data-bulk-proxy');
                            const target = targetSel ? document.querySelector(targetSel) : null;
                            if (target) target.click();
                            menu.style.display = 'none';
                        };
                    }
                } catch (_) {
                    /* ignore */
                }
            }
            async function sendCommand(id, type, payload) {
                try {
                    const wait = type.startsWith('playback.') ? 'false' : 'true';
                    const res = await fetchJSON(
                        `/api/devices/${encodeURIComponent(id)}/command?wait=${wait}`,
                        {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ type, payload }),
                        }
                    );
                    if (res?.ack?.status === 'timeout') {
                        window.notify?.toast({
                            type: 'warning',
                            title: 'No response',
                            message: 'Device did not ack in time',
                        });
                    }
                    return res;
                } catch (e) {
                    window.notify?.toast({
                        type: 'error',
                        title: 'Command failed',
                        message: e?.message || 'Failed to send',
                    });
                    return null;
                }
            }
            function populateMergeOptions() {
                if (!mergeSource || !mergeTarget) return;
                const opts = state.all
                    .map(d => `<option value="${d.id}">${escapeHtml(d.name || d.id)}</option>`)
                    .join('');
                mergeSource.innerHTML = opts;
                mergeTarget.innerHTML = opts;
            }
            function openMergeWith(targetId) {
                populateMergeOptions();
                if (mergeTarget && targetId) mergeTarget.value = targetId;
                const overlay = document.getElementById('modal-merge');
                overlay?.classList.add('open');
            }
            async function submitMerge() {
                const src = mergeSource?.value;
                const tgt = mergeTarget?.value;
                if (!src || !tgt || src === tgt) {
                    return window.notify?.toast({
                        type: 'warning',
                        title: 'Select two different devices',
                    });
                }
                try {
                    const res = await fetchJSON(`/api/devices/${encodeURIComponent(tgt)}/merge`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ sourceIds: [src] }),
                    });
                    if (res?.ok) {
                        window.notify?.toast({
                            type: 'success',
                            title: 'Merged',
                            message: `${res.merged} device merged`,
                        });
                        document.getElementById('modal-merge')?.classList.remove('open');
                        await loadDevices();
                    }
                } catch (e) {
                    window.notify?.toast({
                        type: 'error',
                        title: 'Merge failed',
                        message: e?.message || 'Failed to merge',
                    });
                }
            }

            // Utilities: Modals for pairing, remote, override, send command
            async function openPairingFor(ids, overrides) {
                if (!Array.isArray(ids) || !ids.length) return;
                const container = document.getElementById('pairing-list');
                if (container) {
                    // Reset previous content and timers if any
                    container.innerHTML = '';
                    if (container._tickTimer) {
                        try {
                            clearInterval(container._tickTimer);
                        } catch (_) {}
                        container._tickTimer = null;
                    }
                    if (container._pairPollTimer) {
                        try {
                            clearInterval(container._pairPollTimer);
                        } catch (_) {}
                        container._pairPollTimer = null;
                    }
                }
                // Keep title static; show device name inside content name bar if single selection
                try {
                    const bar = document.getElementById('pairing-namebar');
                    const text = document.getElementById('pairing-namebar-text');
                    if (bar && text) {
                        if (ids.length === 1) {
                            const firstId = ids[0];
                            const dev = (state.all || []).find(d => d.id === firstId);
                            const meta = (overrides && overrides[firstId]) || {};
                            const name = meta.name || dev?.name || firstId;
                            text.textContent = String(name);
                            bar.hidden = false;
                        } else {
                            bar.hidden = true;
                            text.textContent = '—';
                        }
                    }
                } catch (_) {
                    /* non-fatal */
                }
                const fmtExp = ms => {
                    const s = Math.max(0, Math.round(ms / 1000));
                    const m = Math.floor(s / 60);
                    const r = s % 60;
                    return m ? `${m}m ${r}s` : `${r}s`;
                };
                // Track generated codes to detect successful claims and auto-close modal
                const watchers = [];
                for (const id of ids) {
                    try {
                        const r = await fetchJSON(
                            `/api/devices/${encodeURIComponent(id)}/pairing-code`,
                            {
                                method: 'POST',
                                // Requires admin session; allow cookies (default in fetchJSON)
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ ttlMs: 600000, requireToken: false }),
                            }
                        );
                        const dev = (state.all || []).find(d => d.id === id);
                        const meta = (overrides && overrides[id]) || {};
                        const location =
                            meta.location != null ? meta.location : dev?.location || '';
                        const groupIds = Array.isArray(meta.groups)
                            ? meta.groups
                            : Array.isArray(dev?.groups)
                              ? dev.groups
                              : [];
                        // Map group ids to names using state.groups
                        const groups = Array.isArray(groupIds)
                            ? groupIds
                                  .map(gid => {
                                      const g = (state.groups || []).find(
                                          x => String(x.id) === String(gid)
                                      );
                                      return g ? g.name || g.id : gid;
                                  })
                                  .filter(Boolean)
                            : [];
                        // Determine a safe origin for Claim URL. Prefer current window.origin when location is not an absolute URL
                        let baseOrigin = '';
                        try {
                            // If location looks like a full URL, use that; else fallback to current origin
                            if (typeof location === 'string' && /^https?:\/\//i.test(location)) {
                                baseOrigin = new URL(location).origin;
                            } else if (location && location.origin) {
                                baseOrigin = String(location.origin);
                            } else {
                                baseOrigin = window.location.origin;
                            }
                        } catch (_) {
                            baseOrigin = window.location.origin;
                        }
                        const claimUrl = `${baseOrigin}/?pair=${encodeURIComponent(r?.code || '')}`;
                        if (r?.code) {
                            watchers.push({ id, code: String(r.code) });
                        }
                        const ttlMs =
                            Number(r?.expiresInMs) ||
                            Math.max(0, Date.parse(r?.expiresAt || 0) - Date.now());
                        const expMs = Math.max(0, ttlMs);
                        const expAt = Date.now() + expMs;
                        const tagHtml = `
                            <div class="pairing-tags" aria-label="Device attributes">
                                ${location ? `<span class="pill" title="Location"><i class="fas fa-location-dot"></i> ${escapeHtml(String(location))}</span>` : ''}
                                ${groups.map(g => `<span class="pill" title="Group"><i class="fas fa-layer-group"></i> ${escapeHtml(String(g))}</span>`).join(' ')}
                            </div>`;
                        const html = `
                            <div class="pairing-item" data-expires-at="${String(expAt)}">
                                <div class="pairing-meta">
                                    <div class="pairing-header">
                                        ${tagHtml}
                                    </div>
                                    <div class="pairing-row">
                                        <div class="pairing-label">Code</div>
                                        <div class="pairing-copy">
                                            <code class="pairing-code">${escapeHtml(r?.code || '—')}</code>
                                            <button class="btn btn-outline btn-sm" data-copy="${escapeHtml(
                                                r?.code || ''
                                            )}"><i class="fas fa-copy"></i> Copy</button>
                                        </div>
                                    </div>
                                    <div class="pairing-row">
                                        <div class="pairing-label">Claim URL</div>
                                        <div class="pairing-copy">
                                            <code class="pairing-code pairing-url">${escapeHtml(claimUrl)}</code>
                                            <button class="btn btn-outline btn-sm" data-copy="${escapeHtml(
                                                claimUrl
                                            )}"><i class="fas fa-copy"></i> Copy</button>
                                        </div>
                                    </div>
                                    
                                </div>
                            </div>`;
                        if (container) container.insertAdjacentHTML('beforeend', html);
                    } catch (e) {
                        window.notify?.toast({
                            type: 'error',
                            title: 'Pairing',
                            message: `Failed for ${id}`,
                        });
                    }
                }
                if (container && !container._copyBound) {
                    container.addEventListener('click', async ev => {
                        const btn = ev.target?.closest('[data-copy]');
                        if (!btn) return;
                        const val = btn.getAttribute('data-copy') || '';
                        try {
                            await navigator.clipboard.writeText(val);
                            window.notify?.toast({ type: 'success', title: 'Copied to clipboard' });
                        } catch (_) {
                            // Fallback: create a temporary textarea to copy from
                            const ta = document.createElement('textarea');
                            ta.value = val;
                            ta.setAttribute('readonly', '');
                            ta.style.position = 'fixed';
                            ta.style.opacity = '0';
                            ta.style.pointerEvents = 'none';
                            document.body.appendChild(ta);
                            ta.select();
                            try {
                                document.execCommand?.('copy');
                            } catch (_) {}
                            window.getSelection()?.removeAllRanges?.();
                            document.body.removeChild(ta);
                        }
                    });
                    container._copyBound = true;
                }
                // Start ticking countdown in modal footer (earliest expiry across items)
                if (container) {
                    const footerEl = document.getElementById('pairing-exp-footer');
                    // Reset previous timer if any
                    if (container._tickTimer) {
                        try {
                            clearInterval(container._tickTimer);
                        } catch (_) {}
                        container._tickTimer = null;
                    }
                    const tick = () => {
                        const items = Array.from(container.querySelectorAll('.pairing-item'));
                        if (!items.length) {
                            if (footerEl) footerEl.textContent = '';
                            return;
                        }
                        const now = Date.now();
                        let minLeft = Infinity;
                        for (const item of items) {
                            const expAt = Number(item.getAttribute('data-expires-at') || '0');
                            const left = Math.max(0, expAt - now);
                            if (left < minLeft) minLeft = left;
                        }
                        if (footerEl) {
                            footerEl.textContent =
                                minLeft > 0 ? `Expires in ${fmtExp(minLeft)}` : 'Expired';
                        }
                    };
                    tick();
                    container._tickTimer = setInterval(tick, 1000);
                }
                // QR removed per UX
                const pairingOverlay = document.getElementById('modal-pairing');
                pairingOverlay?.classList.add('open');

                // Helper to show a short success state and fade out the modal
                function closePairingModalWithSuccess() {
                    try {
                        if (!pairingOverlay) return;
                        const box = pairingOverlay.querySelector('.modal');
                        if (box) {
                            box.innerHTML =
                                '<div class="modal-body"><div class="pairing-success"><i class="fas fa-check-circle"></i><span>Screen Paired</span></div></div>';
                        }
                        // stop timers to avoid UI flicker during fade
                        if (container && container._tickTimer) {
                            try {
                                clearInterval(container._tickTimer);
                            } catch (_) {}
                            container._tickTimer = null;
                        }
                        if (container && container._pairPollTimer) {
                            try {
                                clearInterval(container._pairPollTimer);
                            } catch (_) {}
                            container._pairPollTimer = null;
                        }
                        pairingOverlay.classList.add('fade-out');
                        setTimeout(() => {
                            pairingOverlay.classList.remove('open');
                            pairingOverlay.classList.remove('fade-out');
                        }, 650);
                    } catch (_) {
                        /* noop */
                    }
                }

                // Poll devices to see when any watched code gets claimed, then refresh + close modal
                if (container && watchers.length) {
                    const pollOnce = async () => {
                        try {
                            const list = await fetchJSON('/api/devices').catch(() => null);
                            if (!Array.isArray(list)) return;
                            const byId = new Map(list.map(d => [String(d.id), d]));
                            const now = Date.now();
                            for (const w of watchers) {
                                const d = byId.get(String(w.id));
                                if (!d) continue;
                                const p = d.pairing || {};
                                const lp = Date.parse(p.lastPairedAt || 0) || 0;
                                const codeStillMatches =
                                    p.code && String(p.code) === String(w.code);
                                const recentlyPaired = lp && now - lp < 5 * 60 * 1000; // 5 minutes
                                if (recentlyPaired && !codeStillMatches) {
                                    try {
                                        await loadDevices();
                                    } catch (_) {}
                                    try {
                                        await refreshDevices();
                                    } catch (_) {}
                                    closePairingModalWithSuccess();
                                    // Stop polling after success
                                    if (container._pairPollTimer) {
                                        try {
                                            clearInterval(container._pairPollTimer);
                                        } catch (_) {}
                                        container._pairPollTimer = null;
                                    }
                                    return;
                                }
                            }
                        } catch (_) {
                            /* ignore */
                        }
                    };
                    // Prime once quickly, then poll every 1.5s
                    pollOnce();
                    container._pairPollTimer = setInterval(pollOnce, 1500);
                }
            }
            function openRemoteFor(id) {
                const dev = (state.all || []).find(d => d.id === id);
                const nameEl = document.getElementById('remote-target-name');
                if (nameEl) nameEl.textContent = dev ? `— ${dev.name || dev.id}` : '';
                const overlay = document.getElementById('modal-remote');
                if (!overlay) return;
                // Stash current device id on overlay for delegated handler
                overlay.dataset.targetId = id;
                overlay.classList.add('open');
                // Attach a single delegated click handler once
                if (!overlay._remoteBound) {
                    overlay.addEventListener('click', async ev => {
                        const btn = ev.target?.closest?.('[data-remote]');
                        if (!btn || !overlay.contains(btn)) return;
                        const key = btn.getAttribute('data-remote');
                        const targetId = overlay.dataset.targetId;
                        if (!targetId) return;
                        try {
                            // Brief pulse feedback
                            try {
                                btn.classList.remove('pulse');
                                // Force reflow to restart animation
                                // eslint-disable-next-line no-unused-expressions
                                btn.offsetHeight;
                                btn.classList.add('pulse');
                            } catch (_) {}
                            if (key === 'playpause') {
                                await sendCommand(targetId, 'playback.toggle');
                            } else {
                                await sendCommand(targetId, 'remote.key', { key });
                            }
                        } catch (_) {}
                    });
                    overlay._remoteBound = true;
                }
            }
            async function openOverrideFor(ids) {
                if (!Array.isArray(ids) || !ids.length) return;
                const overlay = document.getElementById('modal-override');
                const textarea = document.getElementById('override-json');
                if (textarea) textarea.value = '{\n  "wallart": { "duration": 30 }\n}';
                overlay?.classList.add('open');
                const applyBtn = document.getElementById('btn-override-apply');
                if (applyBtn) {
                    const newBtn = applyBtn.cloneNode(true);
                    applyBtn.parentNode.replaceChild(newBtn, applyBtn);
                    newBtn.addEventListener('click', async () => {
                        let payload;
                        try {
                            payload = JSON.parse(textarea.value || '{}');
                        } catch (e) {
                            window.notify?.toast({
                                type: 'error',
                                title: 'Invalid JSON',
                                message: e.message,
                            });
                            return;
                        }
                        let ok = 0,
                            fail = 0;
                        for (const id of ids) {
                            try {
                                await fetchJSON(`/api/devices/${encodeURIComponent(id)}`, {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ settingsOverride: payload }),
                                });
                                ok++;
                            } catch (_) {
                                fail++;
                            }
                        }
                        document.getElementById('modal-override')?.classList.remove('open');
                        if (ok)
                            window.notify?.toast({
                                type: 'success',
                                title: 'Overrides applied',
                                message: `${ok}/${ids.length} updated`,
                            });
                        if (fail)
                            window.notify?.toast({
                                type: 'error',
                                title: 'Some failed',
                                message: `${fail} failed`,
                            });
                        await loadDevices();
                    });
                }
            }
            async function openSendCmdFor(ids) {
                if (!Array.isArray(ids) || !ids.length) return;
                const overlay = document.getElementById('modal-sendcmd');
                overlay?.classList.add('open');
                const typeEl = document.getElementById('sendcmd-type');
                const payloadEl = document.getElementById('sendcmd-payload');
                const selectEl = document.getElementById('sendcmd-select');
                const srcWrap = document.getElementById('sendcmd-param-source');
                const srcEl = document.getElementById('sendcmd-source');
                const applyBtn = document.getElementById('btn-sendcmd-apply');
                if (selectEl) {
                    const newSel = selectEl.cloneNode(true);
                    selectEl.parentNode.replaceChild(newSel, selectEl);
                    newSel.addEventListener('change', () => {
                        const v = newSel.value;
                        if (!v) return;
                        if (v === '__custom') {
                            typeEl.value = '';
                            if (payloadEl) payloadEl.value = '';
                            if (srcWrap) srcWrap.style.display = 'none';
                            return;
                        }
                        typeEl.value = v;
                        // Always refresh payload textarea to match command selection
                        if (payloadEl) {
                            let tpl = '';
                            switch (v) {
                                case 'remote.key':
                                    tpl = '{\n  "key": "up"\n}';
                                    break;
                                case 'source.switch':
                                    tpl = '{\n  "source": "' + (srcEl?.value || 'plex') + '"\n}';
                                    break;
                                case 'playback.pinPoster':
                                    tpl = '{\n  "id": "<posterId>"\n}';
                                    break;
                                default:
                                    tpl = '';
                            }
                            payloadEl.value = tpl;
                        }
                        if (srcWrap) srcWrap.style.display = v === 'source.switch' ? '' : 'none';
                    });
                }
                if (srcEl) {
                    const newSrc = srcEl.cloneNode(true);
                    srcEl.parentNode.replaceChild(newSrc, srcEl);
                    newSrc.addEventListener('change', () => {
                        // If source.switch is selected, keep payload in sync
                        const v = document.getElementById('sendcmd-select')?.value;
                        if (v === 'source.switch' && payloadEl) {
                            payloadEl.value =
                                '{\n  "source": "' + (newSrc.value || 'plex') + '"\n}';
                        }
                    });
                }
                if (applyBtn) {
                    const newBtn = applyBtn.cloneNode(true);
                    applyBtn.parentNode.replaceChild(newBtn, applyBtn);
                    newBtn.addEventListener('click', async () => {
                        const type = String(typeEl?.value || '').trim();
                        if (!type) {
                            window.notify?.toast({
                                type: 'info',
                                title: 'Type required',
                                message: 'Enter a command type',
                            });
                            return;
                        }
                        let payload = undefined;
                        if (payloadEl && payloadEl.value.trim()) {
                            try {
                                payload = JSON.parse(payloadEl.value);
                            } catch (e) {
                                window.notify?.toast({
                                    type: 'error',
                                    title: 'Invalid JSON',
                                    message: e.message,
                                });
                                return;
                            }
                        }
                        let ok = 0,
                            fail = 0;
                        for (const id of ids) {
                            try {
                                await sendCommand(id, type, payload);
                                ok++;
                            } catch (_) {
                                fail++;
                            }
                        }
                        document.getElementById('modal-sendcmd')?.classList.remove('open');
                        if (ok)
                            window.notify?.toast({
                                type: 'success',
                                title: 'Commands sent',
                                message: `${ok}/${ids.length} sent`,
                            });
                        if (fail)
                            window.notify?.toast({
                                type: 'error',
                                title: 'Some failed',
                                message: `${fail} failed`,
                            });
                    });
                }
            }
            mergeConfirm?.addEventListener('click', submitMerge);

            function applyFilters() {
                const q = state.query;
                const fs = state.filterStatus;
                const fr = state.filterRoom;
                const matches = d => {
                    const name = String(d.name || '').toLowerCase();
                    const meta = String(versionMeta(d) || '').toLowerCase();
                    const matchesText = !q || name.includes(q) || meta.includes(q);
                    const status = getStatusClass(d);
                    // Use the same slugification as the filter menu to ensure consistent matching
                    const room = slugify(roomLabel(d));
                    // Support a pseudo-status 'active' that matches either 'live' or 'online'
                    let matchesStatus = true;
                    if (fs) {
                        if (fs === 'active')
                            matchesStatus = status === 'live' || status === 'online';
                        else matchesStatus = status === fs;
                    }
                    const matchesRoom = !fr || room === fr;
                    return matchesText && matchesStatus && matchesRoom;
                };
                state.filteredIds = state.all.filter(matches).map(d => d.id);
                // Failsafe: if no filters are active but nothing matched, show all
                if (!q && !fs && !fr && state.filteredIds.length === 0) {
                    state.filteredIds = state.all.map(d => d.id);
                }
            }
            function renderPage() {
                applyFilters();
                // prepare duplicate maps for current filtered set
                computeDupMaps();
                const total = state.filteredIds.length;
                const perPage = Math.max(1, state.perPage | 0);
                const maxPage = Math.max(1, Math.ceil(total / perPage));
                if (state.currentPage > maxPage) state.currentPage = maxPage;
                const start = (state.currentPage - 1) * perPage;
                const end = start + perPage;
                grid.innerHTML = '';
                if (total === 0) {
                    const empty = document.createElement('div');
                    empty.className = 'empty-state';
                    empty.style.padding = '20px';
                    empty.style.color = 'var(--color-text-muted)';
                    empty.innerHTML =
                        '<i class="fas fa-circle-info"></i> No devices to show. Try clearing filters or check if any devices have registered.';
                    grid.appendChild(empty);
                }
                const pageIds = state.filteredIds.slice(start, end);
                for (const id of pageIds) {
                    const dev = state.all.find(x => x.id === id);
                    const wrapper = document.createElement('div');
                    wrapper.innerHTML = renderCard(dev);
                    const card = wrapper.firstElementChild;
                    grid.appendChild(card);
                    bindCardEvents(card);
                }
                const showing = Math.min(perPage, Math.max(0, total - start));
                if (pageInfo) pageInfo.textContent = `Showing ${showing} of ${total} devices`;
                if (pagePrev) pagePrev.disabled = state.currentPage <= 1;
                if (pageNext) pageNext.disabled = state.currentPage >= maxPage;
                if (pageNumbers) {
                    pageNumbers.innerHTML = '';
                    const maxButtons = 7;
                    let startPage = Math.max(1, state.currentPage - 3);
                    const endPage = Math.min(maxPage, startPage + maxButtons - 1);
                    startPage = Math.max(1, Math.min(startPage, endPage - maxButtons + 1));
                    for (let p = startPage; p <= endPage; p++) {
                        const btn = document.createElement('button');
                        btn.className = 'btn btn-sm' + (p === state.currentPage ? ' active' : '');
                        btn.textContent = String(p);
                        btn.addEventListener('click', () => {
                            state.currentPage = p;
                            renderPage();
                        });
                        pageNumbers.appendChild(btn);
                    }
                }
                updateBulkUI();
                // Re-evaluate per-card action overflow after rendering
                requestAnimationFrame(() => {
                    document
                        .querySelectorAll('#device-grid .device-card')
                        .forEach(collapseCardActions);
                });

                // Re-bind hover listeners for newly rendered pills
                try {
                    bindHover('.js-status-hover', statusCard);
                    bindHover('.js-dupes-hover', dupesCard);
                } catch (_) {}
            }

            // Reflow handlers for responsive action overflow
            const reflowActions = (function () {
                const fn = () => {
                    try {
                        updateBulkUI();
                        document
                            .querySelectorAll('#device-grid .device-card')
                            .forEach(collapseCardActions);
                    } catch (_) {}
                };
                return debounce(fn, 150);
            })();
            window.addEventListener('resize', reflowActions, { passive: true });
            // Run once on first paint to set initial overflow state
            requestAnimationFrame(reflowActions);

            // Build toolbar menus dynamically
            function buildActionsMenu() {
                const menu = document.getElementById('device-actions-menu');
                if (!menu) return;
                dbg('buildActionsMenu()');
                menu.innerHTML = `
                    <div class="dropdown-item" data-device-action="create-device"><i class="fas fa-plus"></i> New device…</div>
                    <div class="dropdown-divider"></div>
                    <div class="dropdown-item" data-device-action="merge"><i class="fas fa-object-group"></i> Merge selected</div>
                    <div class="dropdown-item" data-device-action="groups"><i class="fas fa-layer-group"></i> Groups…</div>
                    <div class="dropdown-item" data-device-action="presets"><i class="fas fa-star"></i> Presets…</div>
                    <div class="dropdown-item" data-device-action="location"><i class="fas fa-location-dot"></i> Assign location</div>
                    <div class="dropdown-heading">Selection</div>
                    <div class="dropdown-item" data-device-action="select-all"><i class="fas fa-check-double"></i> Select all</div>
                    <div class="dropdown-item" data-device-action="clear-selection"><i class="fas fa-eraser"></i> Clear selection</div>
                    <div class="dropdown-divider"></div>
                    <div class="dropdown-item" data-device-action="delete"><i class="fas fa-trash"></i> Delete selected</div>`;
            }

            function buildFilterMenu() {
                const menu = document.getElementById('device-filter-menu');
                if (!menu) return;
                dbg('buildFilterMenu()');
                const roomsSet = new Set();
                let hasUnassigned = false;
                (state.all || []).forEach(d => {
                    const loc = (d && d.location != null ? String(d.location) : '').trim();
                    if (!loc) hasUnassigned = true;
                    else roomsSet.add(loc);
                });
                const rooms = Array.from(roomsSet).sort((a, b) => a.localeCompare(b));
                const parts = [];
                parts.push('<div class="dropdown-heading">Status</div>');
                parts.push(
                    '<div class="dropdown-item" data-device-filter="status:live"><i class="fas fa-bolt"></i> Live</div>'
                );
                parts.push(
                    '<div class="dropdown-item" data-device-filter="status:online"><i class="fas fa-signal"></i> Online</div>'
                );
                parts.push(
                    '<div class="dropdown-item" data-device-filter="status:offline"><i class="fas fa-plug-circle-xmark"></i> Offline</div>'
                );
                parts.push(
                    '<div class="dropdown-item" data-device-filter="status:unknown"><i class="fas fa-question-circle"></i> Unknown</div>'
                );
                parts.push('<div class="dropdown-heading">Location</div>');
                rooms.forEach(r => {
                    const slug = slugify(r);
                    parts.push(
                        `<div class="dropdown-item" data-device-filter="location:${slug}"><i class="fas fa-location-dot"></i> ${r.replace(/</g, '&lt;')}</div>`
                    );
                });
                if (hasUnassigned) {
                    parts.push(
                        '<div class="dropdown-item" data-device-filter="location:unassigned"><i class="fas fa-circle-dot"></i> Unassigned</div>'
                    );
                }
                // Quick reset to recover from empty result states
                parts.push('<div class="dropdown-divider"></div>');
                parts.push(
                    '<div class="dropdown-item" data-device-filter="clear"><i class="fas fa-filter-circle-xmark"></i> Clear filters</div>'
                );
                menu.innerHTML = parts.join('');
                wireFilterMenuHandlers();
                updateFilterMenuUI();
            }

            // Assign Location modal logic
            const locationInput = document.getElementById('location-input');
            const locationList = document.getElementById('location-list');
            const btnLocationApply = document.getElementById('btn-location-apply');
            const btnLocationClear = document.getElementById('btn-location-clear');
            function openAssignLocationModal() {
                const overlay = document.getElementById('modal-assign-location');
                if (!overlay) return;
                // Prefill if all selected share the same location
                const selected = Array.from(
                    document.querySelectorAll('#device-grid .device-card.selected')
                );
                const locs = new Set(
                    selected.map(
                        c =>
                            (state.all || []).find(d => d.id === c.getAttribute('data-id'))
                                ?.location || ''
                    )
                );
                if (locationInput) locationInput.value = locs.size === 1 ? Array.from(locs)[0] : '';
                // Populate datalist with existing unique locations across all devices
                try {
                    if (locationList) {
                        const roomsSet = new Set();
                        (state.all || []).forEach(d => {
                            const loc = (d && d.location != null ? String(d.location) : '').trim();
                            if (loc) roomsSet.add(loc);
                        });
                        const rooms = Array.from(roomsSet).sort((a, b) => a.localeCompare(b));
                        locationList.innerHTML = rooms
                            .map(r => `<option value="${escapeHtml(r)}"></option>`)
                            .join('');
                    }
                } catch (_) {}
                overlay.classList.add('open');
                setTimeout(() => locationInput?.focus(), 50);
            }
            btnLocationApply?.addEventListener('click', async () => {
                const val = (locationInput?.value || '').trim();
                const ids = Array.from(
                    document.querySelectorAll('#device-grid .device-card.selected')
                ).map(c => c.getAttribute('data-id'));
                if (!ids.length) {
                    window.notify?.toast({ type: 'warning', title: 'No devices selected' });
                    return;
                }
                let ok = 0;
                for (const id of ids) {
                    try {
                        await fetchJSON(`/api/devices/${encodeURIComponent(id)}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ location: val }),
                        });
                        ok++;
                    } catch (_) {
                        /* ignore */
                    }
                }
                window.notify?.toast({
                    type: 'success',
                    title: 'Location updated',
                    message: `${ok}/${ids.length} device${ids.length !== 1 ? 's' : ''}`,
                });
                document.getElementById('modal-assign-location')?.classList.remove('open');
                await loadDevices();
            });
            btnLocationClear?.addEventListener('click', async () => {
                const ids = Array.from(
                    document.querySelectorAll('#device-grid .device-card.selected')
                ).map(c => c.getAttribute('data-id'));
                if (!ids.length) {
                    window.notify?.toast({ type: 'warning', title: 'No devices selected' });
                    return;
                }
                let ok = 0;
                for (const id of ids) {
                    try {
                        await fetchJSON(`/api/devices/${encodeURIComponent(id)}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ location: '' }),
                        });
                        ok++;
                    } catch (_) {
                        /* ignore */
                    }
                }
                window.notify?.toast({
                    type: 'success',
                    title: 'Location cleared',
                    message: `${ok}/${ids.length} device${ids.length !== 1 ? 's' : ''}`,
                });
                document.getElementById('modal-assign-location')?.classList.remove('open');
                await loadDevices();
            });
            locationInput?.addEventListener('keydown', e => {
                if (e.key === 'Enter') btnLocationApply?.click();
            });

            async function loadPresets() {
                try {
                    const list = await fetchJSON('/api/admin/device-presets').catch(() => []);
                    state.presets = Array.isArray(list) ? list : [];
                } catch (_) {
                    state.presets = [];
                }
                // presets dropdown removed; presets available via modal
            }

            async function loadDevices() {
                try {
                    const list = await fetchJSON('/api/devices');
                    state.all = Array.isArray(list) ? list : [];
                    dbg('loadDevices(): count', state.all.length);
                    state.currentPage = 1;
                    buildFilterMenu();
                    populateMergeOptions();
                    renderPage();
                } catch (e) {
                    dbg('loadDevices(): failed', e?.message || e);
                    // Show empty state but don't crash section
                    state.all = [];
                    buildFilterMenu();
                    renderPage();
                }
            }
            async function loadGroupsForCards() {
                try {
                    const list = await fetchJSON('/api/groups');
                    state.groups = Array.isArray(list) ? list : [];
                } catch (_) {
                    state.groups = [];
                }
            }
            // Dropdown toggles within device toolbar and cards
            document.querySelectorAll('#section-devices .dropdown-toggle').forEach(btn => {
                btn.addEventListener('click', e => {
                    e.stopPropagation();
                    const dd = btn.closest('.dropdown');
                    const willOpen = !dd.classList.contains('open');
                    dbg('dropdown toggle click', { id: btn.id, willOpen });
                    document.querySelectorAll('#section-devices .dropdown').forEach(x => {
                        if (x !== dd) x.classList.remove('open');
                    });
                    dd.classList.toggle('open', willOpen);
                    // Reflect state for a11y
                    try {
                        btn.setAttribute('aria-expanded', String(!!willOpen));
                    } catch (_) {}
                });
            });
            document.addEventListener('click', () => {
                document
                    .querySelectorAll('#section-devices .dropdown')
                    .forEach(x => x.classList.remove('open'));
                // Reset aria-expanded on all toggles
                document
                    .querySelectorAll('#section-devices .dropdown-toggle[aria-expanded="true"]')
                    .forEach(b => b.setAttribute('aria-expanded', 'false'));
            });

            deviceSearch?.addEventListener('input', () => {
                state.query = (deviceSearch.value || '').toLowerCase();
                state.currentPage = 1;
                renderPage();
            });
            perPageSel?.addEventListener('change', () => {
                state.perPage = parseInt(perPageSel.value, 10) || 9;
                state.currentPage = 1;
                renderPage();
            });
            pagePrev?.addEventListener('click', () => {
                if (state.currentPage > 1) {
                    state.currentPage--;
                    renderPage();
                }
            });
            pageNext?.addEventListener('click', () => {
                const total = state.filteredIds.length;
                const maxPage = Math.max(1, Math.ceil(total / Math.max(1, state.perPage | 0)));
                if (state.currentPage < maxPage) {
                    state.currentPage++;
                    renderPage();
                }
            });
            // Load groups first (for name mapping), then devices
            loadGroupsForCards().finally(loadDevices);

            // Hovercards (status, dupes)
            function createHovercard(id, html) {
                let el = document.getElementById(id);
                if (!el) {
                    el = document.createElement('div');
                    el.className = 'hovercard';
                    el.id = id;
                    el.innerHTML = html;
                    document.body.appendChild(el);
                }
                return el;
            }
            // Helpers for hovercards
            function fmtAgo(ms) {
                if (!ms || Number.isNaN(ms)) return '—';
                const now = Date.now();
                const diff = Math.max(0, now - ms);
                const sec = Math.floor(diff / 1000);
                if (sec < 5) return 'just now';
                if (sec < 60) return `${sec}s ago`;
                const min = Math.floor(sec / 60);
                if (min < 60) return `${min}m ago`;
                const hr = Math.floor(min / 60);
                if (hr < 24) return `${hr}h ago`;
                const day = Math.floor(hr / 24);
                return `${day}d ago`;
            }
            function statusPretty(s) {
                const t = String(s || '').toLowerCase();
                if (t === 'live') return 'Live';
                if (t === 'online') return 'Online';
                if (t === 'unknown') return 'Unknown';
                return 'Offline';
            }
            function statusDotClass(s) {
                const t = String(s || '').toLowerCase();
                if (t === 'live') return 'sd-live';
                if (t === 'online') return 'sd-online';
                if (t === 'unknown') return 'sd-unknown';
                return 'sd-offline';
            }
            const statusHoverHTML =
                '\n                <div class="hc-title"><span class="status-dot sd-online"></span><span>Status</span></div>\n                <div class="hc-list">\n                    <div class="hc-row"><i class="fas fa-plug"></i><span>WebSocket</span><span class="mono value dim">—</span></div>\n                    <div class="hc-row"><i class="fas fa-clock"></i><span>Last seen</span><span class="mono value dim">—</span></div>\n                    <div class="hc-row"><i class="fas fa-hashtag"></i><span>Device ID</span><span class="mono value dim">—</span></div>\n                    <div class="hc-row"><i class="fas fa-expand"></i><span>Resolution</span><span class="mono value dim">—</span></div>\n                    <div class="hc-row"><i class="fas fa-sliders"></i><span>Mode</span><span class="mono value dim">—</span></div>\n                    <div class="hc-row hc-ua"><i class="fas fa-globe"></i><span>User agent</span><span class="mono value dim">—</span></div>\n                </div>';
            const dupesHoverHTML =
                '\n                <div class="hc-title">Duplicates found</div>\n                <div class="hc-list"><div class="hc-row"><span>No details</span></div></div>';
            const statusCard = createHovercard('hc-status', statusHoverHTML);
            const dupesCard = createHovercard('hc-dupes', dupesHoverHTML);
            function positionHover(el, trigger) {
                const r = trigger.getBoundingClientRect();
                const margin = 8;
                const top = window.scrollY + r.top + r.height + margin;
                const left = Math.min(
                    window.scrollX + r.left,
                    window.scrollX + window.innerWidth - el.offsetWidth - margin
                );
                el.style.top = top + 'px';
                el.style.left = left + 'px';
            }
            function bindHover(selector, card) {
                document.querySelectorAll(selector).forEach(tr => {
                    let hideTimer;
                    const clearHide = () => {
                        if (hideTimer) {
                            clearTimeout(hideTimer);
                            hideTimer = null;
                        }
                    };
                    const show = () => {
                        clearHide();
                        // If status hovercard, rebuild from the device referenced by trigger
                        try {
                            if (card && card.id === 'hc-status') {
                                const cardEl = tr.closest('.device-card');
                                const id = cardEl?.getAttribute('data-id');
                                const d = (state.all || []).find(x => x.id === id);
                                if (d) {
                                    const status = getStatusClass(d);
                                    const ws = d.wsConnected ? 'Connected' : 'Not connected';
                                    const lastTs = Date.parse(d.lastSeenAt || 0) || 0;
                                    const last = lastTs
                                        ? `${fmtAgo(lastTs)}\u00A0·\u00A0${new Date(lastTs).toLocaleString()}`
                                        : '—';
                                    const sc = d?.clientInfo?.screen || {};
                                    const w = Number(sc.w || sc.width || 0) || 0;
                                    const h = Number(sc.h || sc.height || 0) || 0;
                                    const dpr = Number(sc.dpr || sc.scale || 1) || 1;
                                    const res =
                                        w && h
                                            ? `${w}×${h}${dpr && dpr !== 1 ? ` @${dpr}x` : ''}`
                                            : '—';
                                    const mode = d?.clientInfo?.mode || d?.mode || '';
                                    const ua = (
                                        d?.clientInfo?.userAgent ||
                                        d?.clientInfo?.ua ||
                                        ''
                                    ).trim();
                                    const isPO = d?.currentState?.poweredOff === true;
                                    const dotCls =
                                        isPO && status === 'live'
                                            ? 'sd-poweredoff'
                                            : statusDotClass(status);
                                    const titleHTML = `<div class="hc-title"><span class="status-dot ${dotCls}"></span><span>${escapeHtml(isPO && status === 'live' ? 'Powered off' : statusPretty(status))}</span></div>`;
                                    const html = [
                                        titleHTML,
                                        '<div class="hc-list">',
                                        `<div class="hc-row"><i class="fas fa-plug"></i><span>WebSocket</span><span class="mono value ${d.wsConnected ? '' : 'dim'}">${escapeHtml(ws)}</span></div>`,
                                        `<div class="hc-row"><i class="fas fa-clock"></i><span>Last seen</span><span class="mono value ${lastTs ? '' : 'dim'}">${escapeHtml(last)}</span></div>`,
                                        `<div class="hc-row"><i class="fas fa-hashtag"></i><span>Device ID</span><span class="mono value">${escapeHtml(d.id || '—')}</span></div>`,
                                        `<div class="hc-row"><i class="fas fa-expand"></i><span>Resolution</span><span class="mono value ${w && h ? '' : 'dim'}">${escapeHtml(res)}</span></div>`,
                                        `<div class="hc-row"><i class="fas fa-sliders"></i><span>Mode</span><span class="mono value ${mode ? '' : 'dim'}">${escapeHtml(modeLabel(mode) || '—')}</span></div>`,
                                        `<div class="hc-row hc-ua"><i class="fas fa-globe"></i><span>User agent</span><span class="mono value ${ua ? '' : 'dim'}" title="${escapeHtml(ua)}">${escapeHtml(ua || '—')}</span></div>`,
                                        '</div>',
                                    ].join('');
                                    card.innerHTML = html;
                                }
                            }
                        } catch (_) {}
                        // If dupes hovercard, rebuild content from trigger datasets
                        try {
                            if (card && card.id === 'hc-dupes') {
                                const title = tr.getAttribute('data-dupes-title') || '';
                                const ids = (tr.getAttribute('data-dupes-ids') || '')
                                    .split(',')
                                    .filter(Boolean);
                                const rows = (title || '').split('\n').slice(1);
                                const listHtml = rows
                                    .filter(Boolean)
                                    .map(
                                        (line, idx) =>
                                            `<div class="hc-row"><i class="fas fa-clone"></i><span>${escapeHtml(line)}</span><button class="btn btn-outline btn-sm" data-merge-tgt="${escapeHtml(tr.closest('.device-card')?.getAttribute('data-id') || '')}" data-merge-src="${escapeHtml(ids[idx] || '')}"><i class="fas fa-object-group"></i> Merge</button></div>`
                                    )
                                    .join('');
                                card.innerHTML = `
                                    <div class="hc-title">Duplicates found</div>
                                    <div class="hc-list">${listHtml || '<div class="hc-row"><span>No details</span></div>'}</div>
                                `;
                                card.querySelectorAll('button[data-merge-tgt]').forEach(btn => {
                                    btn.addEventListener('click', () => {
                                        const tgt = btn.getAttribute('data-merge-tgt');
                                        const src = btn.getAttribute('data-merge-src');
                                        openMergeWith(tgt);
                                        if (src) {
                                            const srcSel = document.getElementById('merge-source');
                                            if (srcSel) srcSel.value = src;
                                        }
                                    });
                                });
                            }
                        } catch (_) {}
                        positionHover(card, tr);
                        card.classList.add('open');
                        // Track the current trigger so we can live-refresh while open
                        try {
                            card._trigger = tr;
                        } catch (_) {}
                    };
                    const hide = () => {
                        clearHide();
                        card.classList.remove('open');
                        try {
                            card._trigger = null;
                        } catch (_) {}
                    };
                    tr.addEventListener('mouseenter', show);
                    tr.addEventListener('focus', show);
                    tr.addEventListener('mouseleave', e => {
                        if (e.relatedTarget && card.contains(e.relatedTarget)) return;
                        clearHide();
                        hideTimer = setTimeout(hide, 350);
                    });
                    tr.addEventListener('blur', () => {
                        setTimeout(() => {
                            if (!tr.matches(':hover') && !card.matches(':hover')) hide();
                        }, 200);
                    });
                    card.addEventListener('mouseenter', clearHide);
                    card.addEventListener('mousedown', clearHide);
                    card.addEventListener('mouseleave', e => {
                        if (e.relatedTarget && tr.contains(e.relatedTarget)) return;
                        hide();
                    });
                });
            }
            bindHover('.js-status-hover', statusCard);
            bindHover('.js-dupes-hover', dupesCard);

            // (removed) toolbar presets handlers

            // Toolbar actions menu (merge, group, preset, location, selection tools)
            buildActionsMenu();
            // Use event delegation so rebuilt menus keep working
            const actionsMenuEl = document.getElementById('device-actions-menu');
            if (actionsMenuEl) {
                actionsMenuEl.addEventListener('click', async ev => {
                    const item = ev.target?.closest('.dropdown-item');
                    if (!item || !actionsMenuEl.contains(item)) return;
                    ev.stopPropagation();
                    const act = item.getAttribute('data-device-action');
                    if (act === 'create-device') {
                        const overlay = document.getElementById('modal-create-device');
                        const close = () => overlay?.classList.remove('open');
                        // Prepare fields: suggested name + location dropdown + groups
                        const nameEl = document.getElementById('create-device-name');
                        const locSel = document.getElementById('create-device-location-select');
                        const locNew = document.getElementById('create-device-location-new');
                        const groupsSel = document.getElementById('create-device-groups');
                        const devices = state.all || [];
                        const rooms = Array.from(
                            new Set(
                                devices
                                    .map(d =>
                                        d && d.location != null ? String(d.location).trim() : ''
                                    )
                                    .filter(Boolean)
                            )
                        ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
                        // Most common room (fallback to last used)
                        const counts = new Map();
                        for (const r of devices.map(d => (d.location || '').trim()).filter(Boolean))
                            counts.set(r, (counts.get(r) || 0) + 1);
                        let popular = '';
                        for (const [k, v] of counts.entries())
                            if (!popular || v > (counts.get(popular) || 0)) popular = k;
                        const lastLoc = (localStorage.getItem('admin2:last-location') || '').trim();
                        const defaultLoc = lastLoc || popular || '';
                        if (locSel) {
                            const opts = ['<option value="">Unassigned</option>']
                                .concat(
                                    rooms.map(
                                        r =>
                                            `<option value="${r.replace(/"/g, '&quot;')}">${r.replace(/</g, '&lt;')}</option>`
                                    )
                                )
                                .concat(['<option value="__new__">+ Add new location…</option>']);
                            locSel.innerHTML = opts.join('');
                            locSel.value = rooms.includes(defaultLoc) ? defaultLoc : '';
                            locSel.onchange = () => {
                                if (locSel.value === '__new__') {
                                    if (locNew) {
                                        locNew.style.display = '';
                                        setTimeout(() => locNew.focus(), 30);
                                    }
                                } else if (locNew) {
                                    locNew.style.display = 'none';
                                    locNew.value = '';
                                }
                            };
                            // Ensure hidden by default
                            if (locNew) {
                                locNew.style.display = 'none';
                                locNew.value = '';
                            }
                        }
                        // Suggest a friendly default name: "Screen N"
                        const suggestName = () => {
                            const base = 'Screen';
                            let maxN = 0;
                            for (const d of devices) {
                                const nm = (d?.name || '').trim();
                                if (!nm.toLowerCase().startsWith(base.toLowerCase())) continue;
                                const m = nm.match(/(\d+)\s*$/);
                                const n = m
                                    ? parseInt(m[1], 10)
                                    : nm.toLowerCase() === base.toLowerCase()
                                      ? 1
                                      : 0;
                                if (n > maxN) maxN = n;
                            }
                            return `${base} ${maxN + 1}`.trim();
                        };
                        if (nameEl) nameEl.value = suggestName();

                        // Populate groups selector alphabetically
                        if (groupsSel) {
                            const gs = Array.isArray(state.groups) ? state.groups.slice() : [];
                            gs.sort((a, b) =>
                                (a?.name || '').localeCompare(b?.name || '', undefined, {
                                    sensitivity: 'base',
                                })
                            );
                            groupsSel.innerHTML = gs
                                .map(
                                    g =>
                                        `<option value="${String(g.id)}">${escapeHtml(g.name || g.id)}</option>`
                                )
                                .join('');
                        }
                        overlay?.classList.add('open');
                        const confirmBtn = document.getElementById('btn-create-device-confirm');
                        const onConfirm = async () => {
                            confirmBtn?.setAttribute('disabled', 'disabled');
                            try {
                                const name =
                                    document.getElementById('create-device-name')?.value || '';
                                let location = '';
                                if (locSel) {
                                    const v = locSel.value;
                                    if (v === '__new__') location = (locNew?.value || '').trim();
                                    else location = v;
                                }
                                // Generate a unique installId to force a new device record
                                const iid =
                                    self.crypto && self.crypto.randomUUID
                                        ? self.crypto.randomUUID()
                                        : 'iid-' +
                                          Math.random().toString(36).slice(2) +
                                          Date.now().toString(36);
                                const hwid =
                                    'hw-' +
                                    Math.random().toString(36).slice(2) +
                                    '-' +
                                    Date.now().toString(36);
                                const r = await fetchJSON('/api/devices/register', {
                                    method: 'POST',
                                    // Avoid sending cookies so server doesn't reuse pr_iid and upsert previous device
                                    credentials: 'omit',
                                    headers: {
                                        'Content-Type': 'application/json',
                                        'x-install-id': iid,
                                        'x-hardware-id': hwid,
                                    },
                                    body: JSON.stringify({
                                        name,
                                        location,
                                        installId: iid,
                                        hardwareId: hwid,
                                    }),
                                });
                                await loadDevices();
                                const newId = r?.deviceId || r?.device?.id || r?.id;
                                if (!newId) throw new Error('No device id returned');
                                // Assign groups if any selected
                                if (
                                    groupsSel &&
                                    groupsSel.selectedOptions &&
                                    groupsSel.selectedOptions.length
                                ) {
                                    const selected = Array.from(groupsSel.selectedOptions).map(
                                        o => o.value
                                    );
                                    try {
                                        await fetchJSON(
                                            `/api/devices/${encodeURIComponent(newId)}`,
                                            {
                                                method: 'PATCH',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ groups: selected }),
                                            }
                                        );
                                    } catch (_) {
                                        /* noop */
                                    }
                                }
                                close();
                                if (location)
                                    localStorage.setItem('admin2:last-location', location);
                                // Always show pairing right after creating
                                await openPairingFor([newId]);
                                window.notify?.toast({
                                    type: 'success',
                                    title: 'Device created',
                                    message: `Device ${newId} created`,
                                });
                            } catch (e) {
                                window.notify?.toast({
                                    type: 'error',
                                    title: 'Create device failed',
                                    message: e?.message || 'Failed to create device',
                                });
                            } finally {
                                confirmBtn?.removeAttribute('disabled');
                                confirmBtn?.removeEventListener('click', onConfirm);
                            }
                        };
                        confirmBtn?.addEventListener('click', onConfirm);
                        overlay
                            ?.querySelectorAll('[data-close-modal]')
                            ?.forEach(btn => btn.addEventListener('click', close, { once: true }));
                        return;
                    }
                    if (act === 'select-all') {
                        document.querySelectorAll('#device-grid .device-card').forEach(card => {
                            if (card.style.display === 'none') return; // page filtered out
                            const cb = card.querySelector('.device-select');
                            if (cb) {
                                cb.checked = true;
                                card.classList.add('selected');
                            }
                        });
                        updateBulkUI();
                        window.notify?.toast({
                            type: 'info',
                            title: 'Selection',
                            message: 'All on page selected',
                        });
                    } else if (act === 'clear-selection') {
                        document.querySelectorAll('#device-grid .device-select').forEach(cb => {
                            cb.checked = false;
                            cb.closest('.device-card')?.classList.remove('selected');
                        });
                        updateBulkUI();
                        window.notify?.toast({
                            type: 'info',
                            title: 'Selection',
                            message: 'Selection cleared',
                        });
                    } else if (act === 'location') {
                        const selected = Array.from(
                            document.querySelectorAll('#device-grid .device-card.selected')
                        );
                        if (!selected.length) {
                            window.notify?.toast({
                                type: 'info',
                                title: 'No devices selected',
                                message: 'Select one or more devices first',
                            });
                            return;
                        }
                        openAssignLocationModal();
                    } else if (act === 'groups') {
                        const selected = Array.from(
                            document.querySelectorAll('#device-grid .device-card.selected')
                        );
                        if (!selected.length) {
                            window.notify?.toast({
                                type: 'info',
                                title: 'No devices selected',
                                message: 'Select one or more devices first',
                            });
                            return;
                        }
                        openGroupModal();
                    } else if (act === 'presets') {
                        const selected = Array.from(
                            document.querySelectorAll('#device-grid .device-card.selected')
                        );
                        if (!selected.length) {
                            window.notify?.toast({
                                type: 'info',
                                title: 'No devices selected',
                                message: 'Select one or more devices first',
                            });
                            return;
                        }
                        openAssignPresetModal();
                    } else if (act === 'merge') {
                        const selected = Array.from(
                            document.querySelectorAll('#device-grid .device-card.selected')
                        );
                        if (selected.length < 2) {
                            window.notify?.toast({
                                type: 'warning',
                                title: 'Select at least 2 devices',
                                message: 'Pick a source and a target to merge',
                            });
                            return;
                        }
                        // Prefer the last selected as target, others as sources
                        const tgt = selected[selected.length - 1].getAttribute('data-id');
                        populateMergeOptions();
                        if (mergeTarget) mergeTarget.value = tgt;
                        if (mergeSource) {
                            // If exactly two, set source to the other; else leave first option
                            const srcId = selected[0].getAttribute('data-id');
                            if (srcId && srcId !== tgt) mergeSource.value = srcId;
                        }
                        document.getElementById('modal-merge')?.classList.add('open');
                    } else if (act === 'preset') {
                        // Deprecated singular action id; treat like 'presets'
                        const selected = Array.from(
                            document.querySelectorAll('#device-grid .device-card.selected')
                        );
                        if (!selected.length) {
                            window.notify?.toast({
                                type: 'info',
                                title: 'No devices selected',
                                message: 'Select one or more devices first',
                            });
                            return;
                        }
                        openAssignPresetModal();
                    } else if (act === 'delete') {
                        const selectedCards = Array.from(
                            document.querySelectorAll('#device-grid .device-card.selected')
                        );
                        if (!selectedCards.length) {
                            window.notify?.toast({
                                type: 'info',
                                title: 'No devices selected',
                                message: 'Select one or more devices first',
                            });
                            return;
                        }
                        const ids = selectedCards
                            .map(c => c.getAttribute('data-id'))
                            .filter(Boolean);
                        const names = selectedCards
                            .map(
                                c =>
                                    c.querySelector('.device-title .name')?.textContent?.trim() ||
                                    c.getAttribute('data-id')
                            )
                            .filter(Boolean);
                        // Populate and open themed modal
                        const overlay = document.getElementById('modal-delete-devices');
                        const content = document.getElementById('modal-delete-content');
                        const confirmBtn = document.getElementById('btn-confirm-delete-devices');
                        if (content) {
                            const list = names
                                .slice(0, 6)
                                .map(n => `<li>${escapeHtml(n)}</li>`)
                                .join('');
                            const more =
                                names.length > 6 ? `<li>…and ${names.length - 6} more</li>` : '';
                            content.innerHTML = `
                                <p>You're about to permanently delete <strong>${ids.length}</strong> device${ids.length !== 1 ? 's' : ''}. This action cannot be undone.</p>
                                <ul style="margin: 10px 0 0 18px;">${list}${more}</ul>
                            `;
                        }
                        // Clean previous handlers
                        if (confirmBtn) {
                            const newBtn = confirmBtn.cloneNode(true);
                            confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);
                            newBtn.addEventListener('click', async () => {
                                newBtn.classList.add('btn-loading');
                                newBtn.disabled = true;
                                let ok = 0;
                                let fail = 0;
                                for (const id of ids) {
                                    try {
                                        await fetchJSON(`/api/devices/${encodeURIComponent(id)}`, {
                                            method: 'DELETE',
                                        });
                                        ok++;
                                    } catch (_) {
                                        fail++;
                                    }
                                }
                                document
                                    .getElementById('modal-delete-devices')
                                    ?.classList.remove('open');
                                if (ok) {
                                    window.notify?.toast({
                                        type: 'success',
                                        title: 'Deleted',
                                        message: `Deleted ${ok} device${ok !== 1 ? 's' : ''}`,
                                    });
                                }
                                if (fail) {
                                    window.notify?.toast({
                                        type: 'error',
                                        title: 'Some failed',
                                        message: `${fail} could not be deleted`,
                                    });
                                }
                                await loadDevices();
                            });
                        }
                        overlay?.classList.add('open');
                    }
                    document
                        .querySelectorAll('#section-devices .dropdown')
                        .forEach(x => x.classList.remove('open'));
                });
            }

            // Filter menu (toolbar)
            function updateFilterMenuUI() {
                document.querySelectorAll('#device-filter-menu .dropdown-item').forEach(it => {
                    const val = it.getAttribute('data-device-filter') || '';
                    const [type, v] = val.split(':');
                    const active =
                        (type === 'status' && state.filterStatus === v) ||
                        (type === 'location' && state.filterRoom === v);
                    it.classList.toggle('active', !!active);
                });
            }
            function wireFilterMenuHandlers() {
                document.querySelectorAll('#device-filter-menu .dropdown-item').forEach(item => {
                    item.addEventListener('click', () => {
                        const val = item.getAttribute('data-device-filter');
                        const label = item.textContent.trim();
                        const [type, v] = (val || '').split(':');
                        if (type === 'status') {
                            state.filterStatus = state.filterStatus === v ? null : v;
                        } else if (type === 'location') {
                            state.filterRoom = state.filterRoom === v ? null : v;
                        } else if (type === 'clear' || val === 'clear') {
                            state.filterStatus = null;
                            state.filterRoom = null;
                            state.query = '';
                            const deviceSearch = document.getElementById('device-search');
                            if (deviceSearch) deviceSearch.value = '';
                        }
                        state.currentPage = 1;
                        updateFilterMenuUI();
                        renderPage();
                        window.notify?.toast({
                            type: 'info',
                            title: 'Filter',
                            message: `${type} → ${label}`,
                        });
                        document
                            .querySelectorAll('#section-devices .dropdown')
                            .forEach(x => x.classList.remove('open'));
                    });
                });
            }
            // Initial menu builds (populate immediately, even before loadDevices)
            buildActionsMenu();
            buildFilterMenu();
            loadPresets();
            // Mark as initialized only after core menus are present
            try {
                section.dataset.inited = '1';
                dbg('initDevices(): initialized');
            } catch (_) {}
            // Load syncEnabled from /get-config so we can show 'Synced' badge on devices
            (async () => {
                try {
                    const cfg = await fetchJSON('/get-config').catch(() => null);
                    if (cfg && typeof cfg.syncEnabled !== 'undefined') {
                        state.syncEnabled = !!cfg.syncEnabled;
                    } else {
                        state.syncEnabled = true; // default enabled when not specified
                    }
                } catch (_) {
                    state.syncEnabled = undefined;
                }
            })();

            // Live reconcile: periodically refresh toolbar states from device-reported truth
            let devicesLiveTimer = null;
            const DEVICES_LIVE_INTERVAL = 3000; // 3s is snappy without being too chatty
            function isDevicesSectionVisible() {
                try {
                    const cs = getComputedStyle(section);
                    return cs.display !== 'none' && cs.visibility !== 'hidden';
                } catch (_) {
                    return true;
                }
            }
            async function reconcileDeviceToolbarStatesOnce() {
                try {
                    const list = await fetchJSON('/api/devices').catch(() => null);
                    if (!Array.isArray(list)) return;
                    // Keep in-memory state fresh for hovercards and filters
                    try {
                        state.all = list;
                    } catch (_) {}
                    const byId = new Map(
                        list.map(d => [String(d.id || d.deviceId || d._id || d.name || ''), d])
                    );
                    document.querySelectorAll('#device-grid .device-card').forEach(card => {
                        const id = card.getAttribute('data-id');
                        if (!id) return;
                        const d = byId.get(id);
                        if (!d) return;

                        // Play/Pause button truth from device state
                        const ppBtn = card.querySelector('.btn-playpause');
                        if (ppBtn) {
                            const paused = d?.currentState?.paused === true;
                            ppBtn.classList.toggle('is-paused', paused);
                            ppBtn.classList.toggle('is-playing', !paused);
                            const icon = ppBtn.querySelector('i');
                            if (icon) icon.className = `fas ${paused ? 'fa-pause' : 'fa-play'}`;
                            ppBtn.title = paused ? 'Resume' : 'Pause';
                        }

                        // Pin button truth from device state
                        const pinBtn = card.querySelector('.btn-pin');
                        if (pinBtn) {
                            const pinned = isDevicePinned(d);
                            pinBtn.classList.toggle('is-pinned', pinned);
                            try {
                                pinBtn.setAttribute('aria-pressed', pinned ? 'true' : 'false');
                            } catch (_) {}
                            const icon = pinBtn.querySelector('i');
                            if (icon)
                                icon.className = `fas ${pinned ? 'fa-map-pin' : 'fa-thumbtack'}`;
                            pinBtn.title = pinned ? 'Unpin poster' : 'Pin current poster';
                        }

                        // Status pill + synced-dot + power button enablement
                        try {
                            const status = getStatusClass(d);
                            // Keep data-status attribute in sync for styling/hooks
                            try {
                                card.setAttribute('data-status', status);
                            } catch (_) {}
                            // Update only the status pill (js-status-hover) and replace its inner content to avoid duplicates
                            const statusPill = card.querySelector(
                                '.device-badges .js-status-hover'
                            );
                            if (statusPill) {
                                const prev =
                                    (statusPill.className.match(
                                        /status-(live|online|offline|unknown)/
                                    ) || [])[0] || '';
                                const nextCls = `status-${status}`;
                                const changed = prev !== nextCls;
                                statusPill.classList.remove(
                                    'status-live',
                                    'status-online',
                                    'status-offline',
                                    'status-unknown'
                                );
                                statusPill.classList.add(nextCls);
                                const po = d?.currentState?.poweredOff === true;
                                const labelText =
                                    status === 'live'
                                        ? po
                                            ? 'Powered off'
                                            : 'Live'
                                        : status === 'online'
                                          ? 'Online'
                                          : status === 'unknown'
                                            ? 'Unknown'
                                            : 'Offline';
                                const ico = iconForStatus(
                                    po && status === 'live' ? 'offline' : status
                                );
                                statusPill.innerHTML = `<i class="${ico}"></i> ${labelText}`;
                                if (changed) {
                                    // retrigger animation by toggling the class
                                    statusPill.classList.remove('status-flip');
                                    // force reflow
                                    // eslint-disable-next-line no-unused-expressions
                                    statusPill.offsetWidth;
                                    statusPill.classList.add('status-flip');
                                    setTimeout(
                                        () => statusPill.classList.remove('status-flip'),
                                        600
                                    );
                                }
                            }
                            // Synced dot visibility
                            const corner = card.querySelector('.device-corner .synced-dot');
                            const shouldShowDot = !!d.wsConnected && state.syncEnabled !== false;
                            if (corner) {
                                corner.style.display = shouldShowDot ? '' : 'none';
                            } else if (shouldShowDot) {
                                // Create the corner container + dot if missing
                                const cornerWrap = document.createElement('div');
                                cornerWrap.className = 'device-corner';
                                const dot = document.createElement('span');
                                dot.className = 'synced-dot';
                                dot.setAttribute('role', 'status');
                                dot.setAttribute('aria-label', 'Device will align to sync ticks');
                                dot.title = 'Device will align to sync ticks';
                                cornerWrap.appendChild(dot);
                                // Insert at the top of card
                                card.insertBefore(cornerWrap, card.firstChild);
                            }
                            // Power button disabled when offline; magenta icon when powered off
                            const powerBtn = card.querySelector('.btn-power');
                            if (powerBtn) {
                                powerBtn.disabled = status === 'offline';
                                const po = d?.currentState?.poweredOff === true;
                                powerBtn.classList.toggle('is-off', po);
                                if (po) powerBtn.title = 'Power Toggle (Powered off)';
                            }
                            // Disable other controls while offline or powered off
                            try {
                                const disabled =
                                    status === 'offline' || d?.currentState?.poweredOff === true;
                                const sel = [
                                    '.btn-remote',
                                    '.btn-sendcmd',
                                    '.btn-playpause',
                                    '.btn-pin',
                                ];
                                sel.forEach(s => {
                                    const el = card.querySelector(s);
                                    if (el) el.disabled = disabled;
                                });
                            } catch (_) {}
                            // No separate powered-off pill anymore
                        } catch (_) {}
                    });

                    // If the status hovercard is currently open, refresh its content live
                    try {
                        const hc = document.getElementById('hc-status');
                        if (hc && hc.classList.contains('open') && hc._trigger) {
                            const tr = hc._trigger;
                            const cardEl = tr.closest('.device-card');
                            const did = cardEl?.getAttribute('data-id');
                            const d = byId.get(did);
                            if (d) {
                                const status = getStatusClass(d);
                                const ws = d.wsConnected ? 'Connected' : 'Not connected';
                                const lastTs = Date.parse(d.lastSeenAt || 0) || 0;
                                const last = lastTs
                                    ? `${fmtAgo(lastTs)}\u00A0·\u00A0${new Date(lastTs).toLocaleString()}`
                                    : '—';
                                const sc = d?.clientInfo?.screen || {};
                                const w = Number(sc.w || sc.width || 0) || 0;
                                const h = Number(sc.h || sc.height || 0) || 0;
                                const dpr = Number(sc.dpr || sc.scale || 1) || 1;
                                const res =
                                    w && h
                                        ? `${w}×${h}${dpr && dpr !== 1 ? ` @${dpr}x` : ''}`
                                        : '—';
                                const mode = d?.clientInfo?.mode || d?.mode || '';
                                const ua = (
                                    d?.clientInfo?.userAgent ||
                                    d?.clientInfo?.ua ||
                                    ''
                                ).trim();
                                const isPO = d?.currentState?.poweredOff === true;
                                const dotCls =
                                    isPO && status === 'live'
                                        ? 'sd-poweredoff'
                                        : statusDotClass(status);
                                const titleHTML = `<div class="hc-title"><span class="status-dot ${dotCls}"></span><span>${escapeHtml(isPO && status === 'live' ? 'Powered off' : statusPretty(status))}</span></div>`;
                                const html = [
                                    titleHTML,
                                    '<div class="hc-list">',
                                    `<div class=\"hc-row\"><i class=\"fas fa-plug\"></i><span>WebSocket</span><span class=\"mono value ${d.wsConnected ? '' : 'dim'}\">${escapeHtml(ws)}</span></div>`,
                                    `<div class=\"hc-row\"><i class=\"fas fa-clock\"></i><span>Last seen</span><span class=\"mono value ${lastTs ? '' : 'dim'}\">${escapeHtml(last)}</span></div>`,
                                    `<div class=\"hc-row\"><i class=\"fas fa-hashtag\"></i><span>Device ID</span><span class=\"mono value\">${escapeHtml(d.id || '—')}</span></div>`,
                                    `<div class=\"hc-row\"><i class=\"fas fa-expand\"></i><span>Resolution</span><span class=\"mono value ${w && h ? '' : 'dim'}\">${escapeHtml(res)}</span></div>`,
                                    `<div class=\"hc-row\"><i class=\"fas fa-sliders\"></i><span>Mode</span><span class=\"mono value ${mode ? '' : 'dim'}\">${escapeHtml(modeLabel(mode) || '—')}</span></div>`,
                                    `<div class=\"hc-row hc-ua\"><i class=\"fas fa-globe\"></i><span>User agent</span><span class=\"mono value ${ua ? '' : 'dim'}\" title=\"${escapeHtml(ua)}\">${escapeHtml(ua || '—')}</span></div>`,
                                    '</div>',
                                ].join('');
                                hc.innerHTML = html;
                                // Keep position anchored to trigger
                                positionHover(hc, tr);
                            }
                        }
                    } catch (_) {}
                } catch (_) {
                    /* ignore transient errors */
                }
                // After applying live updates, re-evaluate filters; if set changed, re-render
                try {
                    const before = Array.isArray(state.filteredIds)
                        ? state.filteredIds.slice()
                        : [];
                    applyFilters();
                    const after = state.filteredIds || [];
                    const changed =
                        before.length !== after.length || before.some((id, i) => id !== after[i]);
                    if (changed) {
                        renderPage();
                        return;
                    }
                } catch (_) {}
            }
            function startDevicesLiveReconcile() {
                stopDevicesLiveReconcile();
                if (!isDevicesSectionVisible()) return;
                devicesLiveTimer = setInterval(() => {
                    if (!isDevicesSectionVisible()) return;
                    reconcileDeviceToolbarStatesOnce();
                }, DEVICES_LIVE_INTERVAL);
            }
            function stopDevicesLiveReconcile() {
                if (devicesLiveTimer) {
                    clearInterval(devicesLiveTimer);
                    devicesLiveTimer = null;
                }
            }
            // Start live reconcile now and on tab visibility changes
            startDevicesLiveReconcile();
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) stopDevicesLiveReconcile();
                else startDevicesLiveReconcile();
            });

            // Bulk selection bar (events are bound to selection changes in bindCardEvents)
            document.getElementById('bulk-clear')?.addEventListener('click', () => {
                document.querySelectorAll('#device-grid .device-select').forEach(cb => {
                    cb.checked = false;
                    cb.closest('.device-card')?.classList.remove('selected');
                });
                updateBulkUI();
            });
            document.getElementById('bulk-reload')?.addEventListener('click', async () => {
                const ids = Array.from(
                    document.querySelectorAll('#device-grid .device-card.selected')
                ).map(c => c.getAttribute('data-id'));
                for (const id of ids) await sendCommand(id, 'core.mgmt.reload');
                window.notify?.toast({
                    type: 'info',
                    title: 'Reload',
                    message: `Requested reload for ${ids.length} device${ids.length !== 1 ? 's' : ''}`,
                });
            });
            document.getElementById('bulk-clearcache')?.addEventListener('click', async () => {
                const ids = Array.from(
                    document.querySelectorAll('#device-grid .device-card.selected')
                ).map(c => c.getAttribute('data-id'));
                for (const id of ids) await sendCommand(id, 'core.mgmt.clearCache');
                window.notify?.toast({
                    type: 'success',
                    title: 'Clear cache',
                    message: `Cleared cache on ${ids.length} device${ids.length !== 1 ? 's' : ''}`,
                });
            });
            document.getElementById('bulk-pair')?.addEventListener('click', async () => {
                const ids = Array.from(
                    document.querySelectorAll('#device-grid .device-card.selected')
                ).map(c => c.getAttribute('data-id'));
                await openPairingFor(ids);
            });
            (function () {
                const el = document.getElementById('bulk-remote');
                if (el) el.remove();
            })();
            document.getElementById('bulk-override')?.addEventListener('click', async () => {
                const ids = Array.from(
                    document.querySelectorAll('#device-grid .device-card.selected')
                ).map(c => c.getAttribute('data-id'));
                await openOverrideFor(ids);
            });
            document.getElementById('bulk-sendcmd')?.addEventListener('click', async () => {
                const ids = Array.from(
                    document.querySelectorAll('#device-grid .device-card.selected')
                ).map(c => c.getAttribute('data-id'));
                await openSendCmdFor(ids);
            });
            document.getElementById('bulk-playpause')?.addEventListener('click', async () => {
                const ids = Array.from(
                    document.querySelectorAll('#device-grid .device-card.selected')
                ).map(c => c.getAttribute('data-id'));
                for (const id of ids) await sendCommand(id, 'playback.toggle');
            });
            document.getElementById('bulk-delete')?.addEventListener('click', async () => {
                // reuse existing delete modal flow
                const selectedCards = Array.from(
                    document.querySelectorAll('#device-grid .device-card.selected')
                );
                if (!selectedCards.length) {
                    window.notify?.toast({
                        type: 'info',
                        title: 'No devices selected',
                        message: 'Select one or more devices first',
                    });
                    return;
                }
                const ids = selectedCards.map(c => c.getAttribute('data-id')).filter(Boolean);
                const names = selectedCards
                    .map(
                        c =>
                            c.querySelector('.device-title .name')?.textContent?.trim() ||
                            c.getAttribute('data-id')
                    )
                    .filter(Boolean);
                const overlay = document.getElementById('modal-delete-devices');
                const content = document.getElementById('modal-delete-content');
                const confirmBtn = document.getElementById('btn-confirm-delete-devices');
                if (content) {
                    const list = names
                        .slice(0, 6)
                        .map(n => `<li>${escapeHtml(n)}</li>`)
                        .join('');
                    const more = names.length > 6 ? `<li>…and ${names.length - 6} more</li>` : '';
                    content.innerHTML = `<p>You're about to permanently delete <strong>${ids.length}</strong> device${ids.length !== 1 ? 's' : ''}. This action cannot be undone.</p><ul style="margin:10px 0 0 18px;">${list}${more}</ul>`;
                }
                if (confirmBtn) {
                    const newBtn = confirmBtn.cloneNode(true);
                    confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);
                    newBtn.addEventListener('click', async () => {
                        newBtn.classList.add('btn-loading');
                        newBtn.disabled = true;
                        let ok = 0,
                            fail = 0;
                        for (const id of ids) {
                            try {
                                await fetchJSON(`/api/devices/${encodeURIComponent(id)}`, {
                                    method: 'DELETE',
                                });
                                ok++;
                            } catch (_) {
                                fail++;
                            }
                        }
                        document.getElementById('modal-delete-devices')?.classList.remove('open');
                        if (ok)
                            window.notify?.toast({
                                type: 'success',
                                title: 'Deleted',
                                message: `Deleted ${ok} device${ok !== 1 ? 's' : ''}`,
                            });
                        if (fail)
                            window.notify?.toast({
                                type: 'error',
                                title: 'Some failed',
                                message: `${fail} could not be deleted`,
                            });
                        await loadDevices();
                    });
                }
                overlay?.classList.add('open');
            });
            document.getElementById('bulk-poweroff')?.addEventListener('click', async () => {
                const selectedCards = Array.from(
                    document.querySelectorAll('#device-grid .device-card.selected')
                );
                const ids = selectedCards.map(c => c.getAttribute('data-id'));
                const offline = [];
                // For per-device toast, determine pre-toggle state from state.all
                for (const id of ids) {
                    const dev = (state.all || []).find(d => d.id === id);
                    const statusClass = dev ? getStatusClass(dev) : 'unknown';
                    if (statusClass === 'offline') {
                        offline.push(dev || { id });
                        continue;
                    }
                    const wasOff = !!dev?.currentState?.poweredOff;
                    const res = await sendCommand(id, 'power.toggle');
                    if (!res || res?.ack?.status === 'timeout') {
                        // sendCommand already showed a warning/error toast; skip success toast
                        continue;
                    }
                    const nowOff =
                        typeof res?.state?.poweredOff === 'boolean'
                            ? res.state.poweredOff
                            : !wasOff;
                    const turned = nowOff ? 'off' : 'on';
                    window.notify?.toast({
                        type: nowOff ? 'warning' : 'success',
                        title: 'Power toggle',
                        message: `${dev?.name || id}: ${turned}`,
                    });
                    // Optimistically update local state so subsequent actions reflect new status
                    if (dev) {
                        dev.currentState = dev.currentState || {};
                        dev.currentState.poweredOff = nowOff;
                    }
                }
                if (offline.length > 0) {
                    const names = offline.map(d => d?.name || d?.id || 'Unknown');
                    const preview = names.slice(0, 5).join(', ');
                    const more = names.length > 5 ? ` +${names.length - 5} more` : '';
                    window.notify?.toast({
                        type: 'info',
                        title: 'Offline devices',
                        message: `${names.length} skipped: ${preview}${more}`,
                    });
                }
                // Re-render current page to reflect updated power icon/title tooltips
                renderPage?.();
            });
            updateBulkUI();

            // Modal open buttons in device cards will be bound per-card after render

            // Group modal logic
            const groupSelect = document.getElementById('group-select');
            const btnAssign = document.getElementById('btn-group-assign');
            const btnRemove = document.getElementById('btn-group-remove');
            const btnCreateAssign = document.getElementById('btn-group-create-assign');
            const newGroupInput = document.getElementById('new-group-name');
            async function loadGroups() {
                try {
                    const list = await fetchJSON('/api/groups');
                    if (groupSelect) {
                        groupSelect.innerHTML = list
                            .map(
                                g =>
                                    `<option value="${g.id}">${escapeHtml(g.name || g.id)}</option>`
                            )
                            .join('');
                    }
                } catch (_) {
                    if (groupSelect) groupSelect.innerHTML = '';
                }
            }
            function openGroupModal() {
                loadGroups();
                document.getElementById('modal-group-assign')?.classList.add('open');
            }
            async function patchDeviceGroups(deviceId, mutate) {
                try {
                    const dev = state.all.find(d => d.id === deviceId);
                    const current = Array.isArray(dev?.groups) ? dev.groups.slice() : [];
                    const next = mutate(current);
                    await fetchJSON(`/api/devices/${encodeURIComponent(deviceId)}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ groups: next }),
                    });
                    return true;
                } catch (_) {
                    return false;
                }
            }
            btnAssign?.addEventListener('click', async () => {
                const gid = groupSelect?.value;
                if (!gid) return;
                const selected = Array.from(
                    document.querySelectorAll('#device-grid .device-card.selected')
                ).map(c => c.getAttribute('data-id'));
                let ok = 0;
                for (const id of selected) {
                    // add if missing
                    const res = await patchDeviceGroups(id, arr =>
                        arr.includes(gid) ? arr : [...arr, gid]
                    );
                    if (res) ok++;
                }
                window.notify?.toast({
                    type: 'success',
                    title: 'Group updated',
                    message: `${ok}/${selected.length} devices updated`,
                });
                document.getElementById('modal-group-assign')?.classList.remove('open');
                await loadDevices();
            });
            btnRemove?.addEventListener('click', async () => {
                const gid = groupSelect?.value;
                if (!gid) return;
                const selected = Array.from(
                    document.querySelectorAll('#device-grid .device-card.selected')
                ).map(c => c.getAttribute('data-id'));
                let ok = 0;
                for (const id of selected) {
                    const res = await patchDeviceGroups(id, arr => arr.filter(x => x !== gid));
                    if (res) ok++;
                }
                window.notify?.toast({
                    type: 'success',
                    title: 'Removed from group',
                    message: `${ok}/${selected.length} devices updated`,
                });
                document.getElementById('modal-group-assign')?.classList.remove('open');
                await loadDevices();
            });
            // Assign Preset modal logic
            const presetSelect = document.getElementById('preset-select');
            const btnPresetApply = document.getElementById('btn-preset-apply');
            const btnPresetClear = document.getElementById('btn-preset-clear');
            function openAssignPresetModal() {
                // Populate from state.presets
                const list = Array.isArray(state.presets) ? state.presets : [];
                if (presetSelect) {
                    if (!list.length) {
                        presetSelect.innerHTML =
                            '<option value="" disabled selected>No presets defined</option>';
                    } else {
                        presetSelect.innerHTML = list
                            .map(
                                p =>
                                    `<option value="${(p.key || '').replace(/"/g, '&quot;')}">${(p.name || p.key || '').replace(/</g, '&lt;')}</option>`
                            )
                            .join('');
                    }
                }
                document.getElementById('modal-assign-preset')?.classList.add('open');
            }
            btnPresetApply?.addEventListener('click', async () => {
                const preset = presetSelect?.value || '';
                if (!preset) return;
                const ids = Array.from(
                    document.querySelectorAll('#device-grid .device-card.selected')
                ).map(c => c.getAttribute('data-id'));
                if (!ids.length) {
                    window.notify?.toast({
                        type: 'info',
                        title: 'No devices selected',
                        message: 'Select one or more devices first',
                    });
                    return;
                }
                let ok = 0;
                for (const id of ids) {
                    try {
                        await fetchJSON(`/api/devices/${encodeURIComponent(id)}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ preset }),
                        });
                        ok++;
                    } catch (_) {}
                }
                window.notify?.toast({
                    type: 'success',
                    title: 'Preset applied',
                    message: `Applied to ${ok}/${ids.length} device${ids.length !== 1 ? 's' : ''}`,
                });
                document.getElementById('modal-assign-preset')?.classList.remove('open');
                await loadDevices();
            });
            btnPresetClear?.addEventListener('click', async () => {
                const ids = Array.from(
                    document.querySelectorAll('#device-grid .device-card.selected')
                ).map(c => c.getAttribute('data-id'));
                if (!ids.length) {
                    window.notify?.toast({
                        type: 'info',
                        title: 'No devices selected',
                        message: 'Select one or more devices first',
                    });
                    return;
                }
                let ok = 0;
                for (const id of ids) {
                    try {
                        await fetchJSON(`/api/devices/${encodeURIComponent(id)}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ preset: null }),
                        });
                        ok++;
                    } catch (_) {}
                }
                window.notify?.toast({
                    type: 'success',
                    title: 'Preset cleared',
                    message: `Cleared on ${ok}/${ids.length}`,
                });
                document.getElementById('modal-assign-preset')?.classList.remove('open');
                await loadDevices();
            });
            // Enter key triggers Create & assign
            newGroupInput?.addEventListener('keydown', e => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    btnCreateAssign?.click();
                }
            });
            // Create a new group and assign selected devices
            btnCreateAssign?.addEventListener('click', async () => {
                const name = (newGroupInput?.value || '').trim();
                if (!name) {
                    window.notify?.toast({ type: 'info', title: 'Group name required' });
                    return;
                }
                try {
                    const created = await fetchJSON('/api/groups', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name }),
                    });
                    const gid = created?.id || created?.name || name;
                    await loadGroups();
                    if (groupSelect && gid) groupSelect.value = gid;
                    const selected = Array.from(
                        document.querySelectorAll('#device-grid .device-card.selected')
                    ).map(c => c.getAttribute('data-id'));
                    let ok = 0;
                    for (const id of selected) {
                        const res = await patchDeviceGroups(id, arr =>
                            arr.includes(gid) ? arr : [...arr, gid]
                        );
                        if (res) ok++;
                    }
                    window.notify?.toast({
                        type: 'success',
                        title: 'Group created',
                        message: `Assigned ${ok}/${selected.length} devices to ${gid}`,
                    });
                    document.getElementById('modal-group-assign')?.classList.remove('open');
                    await loadDevices();
                } catch (e) {
                    const msg = e?.message || '';
                    if (/exists|409/i.test(msg)) {
                        window.notify?.toast({
                            type: 'warning',
                            title: 'Group already exists',
                            message: name,
                        });
                    } else {
                        window.notify?.toast({
                            type: 'error',
                            title: 'Create group failed',
                            message: msg || 'Unknown error',
                        });
                    }
                }
            });
        };

        // 2FA disable flow
        btn2faDisable?.addEventListener('click', () => openModal('modal-2fa-disable'));
        const btn2faDisableConfirm = document.getElementById('btn-2fa-disable-confirm');
        const input2faDisablePassword = document.getElementById('input-2fa-disable-password');

        // Allow Enter key to submit disable form
        input2faDisablePassword?.addEventListener('keydown', e => {
            if (e.key === 'Enter' && input2faDisablePassword.value.trim()) {
                btn2faDisableConfirm?.click();
            }
        });

        ensureSpinner(btn2faDisableConfirm);
        btn2faDisableConfirm?.addEventListener('click', async () => {
            const pw = document.getElementById('input-2fa-disable-password');
            const password = pw?.value || '';
            if (!password) {
                return window.notify?.toast({
                    type: 'warning',
                    title: 'Password Required',
                    message: 'Enter your current password to disable two-factor authentication',
                    duration: 3500,
                });
            }
            try {
                btn2faDisableConfirm.classList.add('btn-loading');
                btn2faDisableConfirm.disabled = true;
                const r = await fetch('/api/admin/2fa/disable', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ password }),
                });
                const j = await r.json().catch(() => ({}));
                if (!r.ok) throw new Error(j?.error || j?.message || 'Failed to disable 2FA');
                window.notify?.toast({
                    type: 'success',
                    title: '2FA Disabled',
                    message: 'Two-Factor Authentication has been disabled for your account.',
                    duration: 3500,
                });
                closeModal('modal-2fa-disable');
                refreshSecurity();
                // Clear password field
                if (pw) pw.value = '';
            } catch (e) {
                window.notify?.toast({
                    type: 'error',
                    title: 'Disable Failed',
                    message: e?.message || 'Invalid password or failed to disable 2FA',
                    duration: 5000,
                });
                // Focus password field for retry
                if (pw) {
                    pw.focus();
                    pw.select();
                }
            } finally {
                btn2faDisableConfirm?.classList.remove('btn-loading');
                btn2faDisableConfirm.disabled = false;
            }
        });

        // Change Password Modal
        const btnChangePasswordModal = document.getElementById('btn-change-password');
        const currentPwInput = document.getElementById('input-current-password');
        const newPwInput = document.getElementById('input-new-password');
        const confirmPwInput = document.getElementById('input-confirm-password');
        const strengthIndicator = document.getElementById('password-strength');
        const strengthBars = document.querySelectorAll('.strength-bar');
        const strengthText = document.getElementById('strength-text');

        if (!btnChangePasswordModal) {
            console.error('Change password button not found! ID: btn-change-password');
            return;
        }

        // Password strength checker
        function checkPasswordStrength(password) {
            if (!password) return { score: 0, text: '', color: '' };

            let score = 0;
            const feedback = [];

            // Length check
            if (password.length >= 8) score++;
            else feedback.push('8+ characters');

            // Uppercase check
            if (/[A-Z]/.test(password)) score++;
            else feedback.push('uppercase letter');

            // Lowercase check
            if (/[a-z]/.test(password)) score++;
            else feedback.push('lowercase letter');

            // Number check
            if (/\d/.test(password)) score++;
            else feedback.push('number');

            // Special character check
            if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) score++;
            else feedback.push('special character');

            const strength = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong'][Math.min(score, 4)];
            const colors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#10b981'];

            return {
                score,
                text: feedback.length ? `Add: ${feedback.join(', ')}` : strength,
                color: colors[Math.min(score, 4)],
                strength,
            };
        }

        // Real-time password strength checking
        newPwInput?.addEventListener('input', e => {
            const password = e.target.value;

            if (password) {
                strengthIndicator.style.display = 'block';
                const result = checkPasswordStrength(password);

                // Update strength bars
                strengthBars.forEach((bar, index) => {
                    if (index < result.score) {
                        bar.style.background = result.color;
                    } else {
                        bar.style.background = 'rgba(255,255,255,0.1)';
                    }
                });

                // Update text
                strengthText.textContent = result.text;
                strengthText.style.color = result.color;

                // Update input border
                e.target.style.borderColor =
                    result.score >= 3
                        ? 'var(--color-success)'
                        : result.score >= 2
                          ? 'var(--color-warning)'
                          : 'var(--color-error)';
            } else {
                strengthIndicator.style.display = 'none';
                e.target.style.borderColor = 'rgba(255,255,255,0.1)';
            }

            // Also check password matching when new password changes
            checkPasswordMatch();
        });

        // Function to check password matching
        function checkPasswordMatch() {
            const newPassword = newPwInput?.value || '';
            const confirmPassword = confirmPwInput?.value || '';

            if (confirmPassword) {
                if (newPassword === confirmPassword) {
                    confirmPwInput.style.borderColor = 'var(--color-success)';
                    // Add a small checkmark indicator
                    if (
                        !confirmPwInput.nextElementSibling ||
                        !confirmPwInput.nextElementSibling.classList.contains(
                            'password-match-indicator'
                        )
                    ) {
                        const indicator = document.createElement('div');
                        indicator.className = 'password-match-indicator';
                        indicator.style.cssText = `
                            position: absolute;
                            right: 12px;
                            top: 50%;
                            transform: translateY(-50%);
                            color: var(--color-success);
                            font-size: 14px;
                            pointer-events: none;
                        `;
                        indicator.innerHTML = '<i class="fas fa-check-circle"></i>';
                        confirmPwInput.parentElement.style.position = 'relative';
                        confirmPwInput.parentElement.appendChild(indicator);
                    }
                } else {
                    confirmPwInput.style.borderColor = 'var(--color-error)';
                    // Remove checkmark if it exists
                    const indicator = confirmPwInput.parentElement.querySelector(
                        '.password-match-indicator'
                    );
                    if (indicator) indicator.remove();
                }
            } else {
                confirmPwInput.style.borderColor = 'rgba(255,255,255,0.1)';
                // Remove checkmark if it exists
                const indicator = confirmPwInput.parentElement.querySelector(
                    '.password-match-indicator'
                );
                if (indicator) indicator.remove();
            }
        }

        // Real-time confirm password checking
        confirmPwInput?.addEventListener('input', () => {
            checkPasswordMatch();
        });

        // Enter key support
        [currentPwInput, newPwInput, confirmPwInput].forEach(input => {
            input?.addEventListener('keydown', e => {
                if (e.key === 'Enter') {
                    btnChangePasswordModal?.click();
                }
            });
        });

        ensureSpinner(btnChangePasswordModal);

        // Remove any existing event listeners to prevent duplicates
        const newButton = btnChangePasswordModal.cloneNode(true);
        btnChangePasswordModal.parentNode.replaceChild(newButton, btnChangePasswordModal);
        const btnChangePasswordModalClean = document.getElementById('btn-change-password');
        ensureSpinner(btnChangePasswordModalClean);

        btnChangePasswordModalClean.addEventListener('click', async event => {
            try {
                // Prevent multiple submissions
                if (btnChangePasswordModalClean.disabled) {
                    return;
                }

                console.log('Event object:', event);

                const statusEl = document.getElementById('password-status');
                console.log('Status element found:', !!statusEl);

                const currentPassword = currentPwInput?.value || '';
                const newPassword = newPwInput?.value || '';
                const confirmPassword = confirmPwInput?.value || '';

                console.log('Password values:', {
                    current: currentPassword
                        ? `has value (${currentPassword.length} chars)`
                        : 'empty',
                    new: newPassword ? `has value (${newPassword.length} chars)` : 'empty',
                    confirm: confirmPassword
                        ? `has value (${confirmPassword.length} chars)`
                        : 'empty',
                });

                // Clear status
                if (statusEl) {
                    statusEl.style.display = 'none';
                    statusEl.className = 'status-message';
                }

                // Validate inputs
                if (!currentPassword || !newPassword || !confirmPassword) {
                    console.log('Validation failed: missing fields');
                    if (statusEl) {
                        statusEl.innerHTML = `
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <i class="fas fa-exclamation-triangle" style="color: var(--color-error);"></i>
                                <span>Please fill in all password fields</span>
                            </div>
                        `;
                        statusEl.className = 'status-message error';
                        statusEl.style.display = 'block';
                    }
                    return;
                }

                if (newPassword !== confirmPassword) {
                    console.log('Validation failed: passwords do not match');
                    if (statusEl) {
                        statusEl.innerHTML = `
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <i class="fas fa-times-circle" style="color: var(--color-error);"></i>
                                <span>New passwords do not match</span>
                            </div>
                        `;
                        statusEl.className = 'status-message error';
                        statusEl.style.display = 'block';
                    }
                    return;
                }

                const strengthResult = checkPasswordStrength(newPassword);
                console.log('Password strength check result:', strengthResult);
                if (strengthResult.score < 2) {
                    console.log('Validation failed: password too weak');
                    if (statusEl) {
                        statusEl.innerHTML = `
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <i class="fas fa-shield-alt" style="color: var(--color-warning);"></i>
                                <span>Please choose a stronger password</span>
                            </div>
                        `;
                        statusEl.className = 'status-message error';
                        statusEl.style.display = 'block';
                    }
                    return;
                }

                console.log('All validations passed, making API call...');
                btnChangePasswordModalClean.classList.add('btn-loading');
                btnChangePasswordModalClean.disabled = true;

                const requestBody = {
                    currentPassword,
                    newPassword,
                    confirmPassword: confirmPassword,
                };
                console.log('Request body (passwords masked):', {
                    currentPassword: currentPassword
                        ? `*** (${currentPassword.length} chars)`
                        : 'EMPTY',
                    newPassword: newPassword ? `*** (${newPassword.length} chars)` : 'EMPTY',
                    confirmPassword: confirmPassword
                        ? `*** (${confirmPassword.length} chars)`
                        : 'EMPTY',
                });

                const response = await fetch('/api/admin/change-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify(requestBody),
                });

                console.log('API response status:', response.status);
                const result = await response.json();
                console.log('API response data:', result);

                if (response.ok) {
                    console.log('Password change successful');
                    if (statusEl) {
                        statusEl.innerHTML = `
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <i class="fas fa-check-circle" style="color: var(--color-success);"></i>
                                <span>Password changed successfully! You will be logged out for security.</span>
                            </div>
                        `;
                        statusEl.className = 'status-message success';
                        statusEl.style.display = 'block';
                    }

                    // Clear form
                    if (currentPwInput) currentPwInput.value = '';
                    if (newPwInput) newPwInput.value = '';
                    if (confirmPwInput) confirmPwInput.value = '';
                    if (strengthIndicator) strengthIndicator.style.display = 'none';

                    // Reset input borders
                    [currentPwInput, newPwInput, confirmPwInput].forEach(input => {
                        if (input) input.style.borderColor = 'rgba(255,255,255,0.1)';
                    });

                    // Show success message longer and redirect to login
                    setTimeout(() => {
                        closeModal('modal-change-password');
                        if (statusEl) statusEl.style.display = 'none';
                        // Redirect to login page since user is logged out
                        window.location.href = '/admin';
                    }, 3000); // Increased to 3 seconds

                    if (window.notify?.toast) {
                        window.notify.toast({
                            type: 'success',
                            title: 'Password Changed',
                            message: 'Your password has been updated successfully',
                            duration: 3000,
                        });
                    }
                } else {
                    console.log('Password change failed:', result);
                    if (statusEl) {
                        statusEl.innerHTML = `
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <i class="fas fa-exclamation-circle" style="color: var(--color-error);"></i>
                                <span>${result.error || 'Failed to change password'}</span>
                            </div>
                        `;
                        statusEl.className = 'status-message error';
                        statusEl.style.display = 'block';
                    }
                }
            } catch (error) {
                console.error('MAJOR ERROR in change password handler:', error);
                console.error('Error stack:', error.stack);

                const statusEl = document.getElementById('password-status');
                if (statusEl) {
                    statusEl.innerHTML = `
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <i class="fas fa-wifi" style="color: var(--color-error);"></i>
                            <span>An error occurred: ${error.message}</span>
                        </div>
                    `;
                    statusEl.className = 'status-message error';
                    statusEl.style.display = 'block';
                }
            } finally {
                btnChangePasswordModalClean.classList.remove('btn-loading');
                btnChangePasswordModalClean.disabled = false;
            }
        });

        // Also add a manual test data flag
        if (btnChangePasswordModal) {
            btnChangePasswordModal.setAttribute('data-debug', 'ready');
        }

        // API key management
        const btnApiGenerate = document.getElementById('generate-api-key-button');
        const btnApiRevoke = document.getElementById('revoke-api-key-button');
        ensureSpinner(btnApiGenerate);
        ensureSpinner(btnApiRevoke);
        const btnApiToggle = document.getElementById('toggle-api-key-visibility-button');
        const btnApiCopy = document.getElementById('copy-api-key-button');
        btnApiGenerate?.addEventListener('click', async () => {
            try {
                btnApiGenerate.classList.add('btn-loading');
                const r = await fetch('/api/admin/api-key/generate', {
                    method: 'POST',
                    credentials: 'include',
                });
                const j = await r.json().catch(() => ({}));
                if (!r.ok) throw new Error(j?.error || 'Failed to generate API key');
                const input = document.getElementById('api-key-input');
                if (input) input.value = j.apiKey || '';
                window.notify?.toast({
                    type: 'success',
                    title: 'API key generated',
                    message: 'Copy and store this key securely.',
                    duration: 5000,
                });
                await refreshSecurity();
                await refreshApiKeyStatus(); // Also refresh in Operations section
            } catch (e) {
                window.notify?.toast({
                    type: 'error',
                    title: 'Generate failed',
                    message: e?.message || 'Unable to generate key',
                    duration: 5000,
                });
            } finally {
                btnApiGenerate.classList.remove('btn-loading');
            }
        });
        btnApiRevoke?.addEventListener('click', () => openModal('modal-revoke-api-key'));
        const btnApiRevokeConfirm = document.getElementById('btn-revoke-api-key-confirm');
        btnApiRevokeConfirm?.addEventListener('click', async () => {
            try {
                btnApiRevokeConfirm.classList.add('btn-loading');
                const r = await fetch('/api/admin/api-key/revoke', {
                    method: 'POST',
                    credentials: 'include',
                });
                const j = await r.json().catch(() => ({}));
                if (!r.ok) throw new Error(j?.error || 'Failed to revoke API key');
                window.notify?.toast({
                    type: 'success',
                    title: 'API key revoked',
                    message: 'Key has been removed.',
                    duration: 3500,
                });
                closeModal('modal-revoke-api-key');
                await refreshSecurity();
                await refreshApiKeyStatus(); // Also refresh in Operations section
            } catch (e) {
                window.notify?.toast({
                    type: 'error',
                    title: 'Revoke failed',
                    message: e?.message || 'Unable to revoke key',
                    duration: 5000,
                });
            } finally {
                btnApiRevokeConfirm.classList.remove('btn-loading');
            }
        });
        btnApiToggle?.addEventListener('click', () => {
            const input = document.getElementById('api-key-input');
            if (!input) return;
            const icon = btnApiToggle.querySelector('i');
            const toText = input.type === 'password';
            input.type = toText ? 'text' : 'password';
            if (icon) icon.className = toText ? 'fas fa-eye-slash' : 'fas fa-eye';
        });
        btnApiCopy?.addEventListener('click', async () => {
            const input = document.getElementById('api-key-input');
            if (!input || !input.value) return;
            try {
                await navigator.clipboard.writeText(input.value);
                window.notify?.toast({
                    type: 'success',
                    title: 'Copied',
                    message: 'API key copied to clipboard',
                    duration: 2000,
                });
            } catch (_) {
                window.notify?.toast({
                    type: 'warning',
                    title: 'Clipboard blocked',
                    message: 'Copy not permitted in this context',
                    duration: 2500,
                });
            }
        });

        // OPERATIONS: Refresh Media
        const btnRefreshMedia = document.getElementById('btn-refresh-media');
        if (btnRefreshMedia) {
            if (!btnRefreshMedia.querySelector('.spinner')) {
                const sp = document.createElement('span');
                sp.className = 'spinner';
                btnRefreshMedia.insertBefore(sp, btnRefreshMedia.firstChild);
            }
            btnRefreshMedia.addEventListener('click', async () => {
                try {
                    btnRefreshMedia.classList.add('btn-loading');
                    const r = await fetch('/api/admin/refresh-media', {
                        method: 'POST',
                        credentials: 'include',
                    });
                    const j = await r.json().catch(() => ({}));
                    if (!r.ok) throw new Error(j?.error || 'Refresh failed');
                    window.notify?.toast({
                        type: 'success',
                        title: 'Media refreshed',
                        message: j?.message || 'Sources reloaded',
                        duration: 3500,
                    });
                    // Update "Last sync" values on the Media Sources overview immediately
                    try {
                        await refreshOverviewLastSync();
                    } catch (_) {
                        /* non-fatal */
                    }
                } catch (e) {
                    window.notify?.toast({
                        type: 'error',
                        title: 'Refresh failed',
                        message: e?.message || 'Unable to refresh media',
                        duration: 5000,
                    });
                } finally {
                    btnRefreshMedia.classList.remove('btn-loading');
                }
            });
        }

        // OPERATIONS: Auto-Update controls
        const btnStartUpdate = document.getElementById('btn-start-update');
        const btnRollbackUpdate = document.getElementById('btn-rollback-update');
        const btnListBackups = document.getElementById('btn-list-backups');
        const btnCleanupBackups = document.getElementById('btn-cleanup-backups');

        const ensureBtnSpinner = btn => {
            if (!btn) return;
            if (!btn.querySelector('.spinner')) {
                const sp = document.createElement('span');
                sp.className = 'spinner';
                btn.insertBefore(sp, btn.firstChild);
            }
        };
        [btnStartUpdate, btnRollbackUpdate, btnListBackups, btnCleanupBackups].forEach(
            ensureBtnSpinner
        );

        async function pollUpdateStatusOnce() {
            try {
                const r = await fetch('/api/admin/update/status', { credentials: 'include' });
                if (!r.ok) throw new Error('Status failed');
                const s = await r.json();
                applyUpdateStatusToUI(s);
                return s;
            } catch (e) {
                // Non-fatal; keep idle
                return null;
            }
        }

        let updatePollTimer = null;
        function startUpdatePolling() {
            stopUpdatePolling();
            updatePollTimer = setInterval(pollUpdateStatusOnce, 1500);
        }
        function stopUpdatePolling() {
            if (updatePollTimer) {
                clearInterval(updatePollTimer);
                updatePollTimer = null;
            }
        }

        function applyUpdateStatusToUI(status) {
            const idle = document.getElementById('update-idle-state');
            const prog = document.getElementById('update-progress-state');
            if (!idle || !prog) return;
            const phaseEl = document.getElementById('update-phase-text');
            const pctEl = document.getElementById('update-progress-percent');
            const idlePill = document.getElementById('update-idle-pill');
            const barEl = document.getElementById('update-progress-bar');
            const msgEl = document.getElementById('update-message');
            const isUpdating = !!status?.isUpdating;
            if (isUpdating) {
                idle.style.display = 'none';
                prog.style.display = '';
                if (idlePill) idlePill.style.display = 'none';
                if (phaseEl) phaseEl.style.display = '';
                if (pctEl) pctEl.style.display = '';
                const phase = status?.phase || 'working';
                const pct = Math.max(0, Math.min(100, Number(status?.progress ?? 0)));
                if (phaseEl) phaseEl.textContent = String(phase);
                if (pctEl) pctEl.textContent = pct + '%';
                if (barEl) barEl.style.width = pct + '%';
                if (msgEl) msgEl.textContent = status?.message || '';
                startUpdatePolling();
            } else {
                prog.style.display = 'none';
                idle.style.display = '';
                if (idlePill) idlePill.style.display = '';
                if (phaseEl) phaseEl.style.display = 'none';
                if (pctEl) pctEl.style.display = 'none';
                stopUpdatePolling();
            }
        }

        async function refreshUpdateStatusUI() {
            const s = await pollUpdateStatusOnce();
            if (!s || !s.isUpdating) stopUpdatePolling();
        }

        btnStartUpdate?.addEventListener('click', async () => {
            // Open confirmation modal like legacy Management
            await openUpdateModal();
        });

        btnRollbackUpdate?.addEventListener('click', async () => {
            try {
                btnRollbackUpdate.classList.add('btn-loading');
                const r = await fetch('/api/admin/update/rollback', {
                    method: 'POST',
                    credentials: 'include',
                });
                const j = await r.json().catch(() => ({}));
                if (!r.ok) throw new Error(j?.error || 'Rollback failed');
                window.notify?.toast({
                    type: 'success',
                    title: 'Rollback complete',
                    message: j?.message || 'Application rolled back',
                    duration: 4000,
                });
                await refreshUpdateStatusUI();
            } catch (e) {
                window.notify?.toast({
                    type: 'error',
                    title: 'Rollback failed',
                    message: e?.message || 'Unable to rollback',
                    duration: 5000,
                });
            } finally {
                btnRollbackUpdate.classList.remove('btn-loading');
            }
        });

        btnListBackups?.addEventListener('click', async () => {
            const container = document.getElementById('backups-display');
            const list = document.getElementById('backups-content');
            if (!container || !list) return;
            container.style.display = '';
            list.innerHTML = '<div class="subtle">Loading…</div>';
            try {
                const r = await fetch('/api/admin/update/backups', { credentials: 'include' });
                const arr = r.ok ? await r.json() : [];
                if (!Array.isArray(arr) || arr.length === 0) {
                    list.innerHTML = '<div class="subtle">No backups available</div>';
                    return;
                }
                list.innerHTML = '';
                arr.forEach(b => {
                    const row = document.createElement('div');
                    row.className = 'chip';
                    row.innerHTML = `<div class="left"><i class="fas fa-archive"></i><span class="title">${b.name || b.version || 'Backup'}</span></div><span class="subtle">${(b.created || b.timestamp || '').toString()}</span>`;
                    list.appendChild(row);
                });
            } catch (e) {
                list.innerHTML = '<div class="subtle">Failed to load backups</div>';
            }
        });

        btnCleanupBackups?.addEventListener('click', async () => {
            const keepEl = document.getElementById('input-keep-backups');
            const keepCount = Math.max(1, Math.min(20, Number(keepEl?.value || 5)));
            try {
                btnCleanupBackups.classList.add('btn-loading');
                const r = await fetch('/api/admin/update/cleanup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ keepCount }),
                    credentials: 'include',
                });
                const j = await r.json().catch(() => ({}));
                if (!r.ok) throw new Error(j?.error || 'Cleanup failed');
                window.notify?.toast({
                    type: 'success',
                    title: 'Cleanup completed',
                    message: j?.message || `Kept ${j?.kept ?? keepCount}`,
                    duration: 4000,
                });
                // refresh list
                document.getElementById('btn-list-backups')?.click();
            } catch (e) {
                window.notify?.toast({
                    type: 'error',
                    title: 'Cleanup failed',
                    message: e?.message || 'Unable to cleanup backups',
                    duration: 5000,
                });
            } finally {
                btnCleanupBackups.classList.remove('btn-loading');
            }
        });

        // Initial population if Operations is default later
        if (document.getElementById('section-operations')?.classList.contains('active')) {
            refreshOperationsPanels();
        }
    }

    // exportMetrics removed with header Export button

    async function refreshAll() {
        await Promise.all([refreshDevices(), refreshPerfDashboard(), refreshVersionAndUpdate()]);
        await refreshCacheStatsV2();
    }

    // Initialize cache actions and kick off initial refreshes
    wireCacheActions();
    refreshAll();
    // Fallback: ensure Devices section gets initialized even if user lands directly
    try {
        window.admin2?.initDevices?.();
    } catch (_) {}
    // If dashboard is the active tab on load, start live updates
    try {
        const dashEl = document.getElementById('section-dashboard');
        const isDash = !!dashEl && dashEl.classList.contains('active');
        if (isDash) {
            startDashboardLive();
            startPerfLive();
        }
    } catch (_) {
        /* no-op */
    }
    // Pause/resume polling when the tab/window visibility changes
    try {
        document.addEventListener('visibilitychange', () => {
            const isHidden = document.visibilityState === 'hidden';
            if (isHidden) {
                stopDashboardLive();
                stopPerfLive();
            } else {
                const isDashActive = document
                    .getElementById('section-dashboard')
                    ?.classList.contains('active');
                if (isDashActive) {
                    startDashboardLive();
                    startPerfLive();
                }
            }
        });
    } catch (_) {
        /* ignore */
    }

    // Wire only the dashboard metric numbers (kept isolated so failures elsewhere don't block it)
    function wireDashboardMetricShortcuts() {
        try {
            const makeClickable = (id, handler, title) => {
                const el = document.getElementById(id);
                if (!el || el.dataset.wired === 'true') return;
                el.dataset.wired = 'true';
                el.tabIndex = 0;
                el.setAttribute('role', 'button');
                if (title) el.setAttribute('title', title);
                el.style.cursor = 'pointer';
                const onActivate = evt => {
                    evt.preventDefault();
                    handler();
                };
                el.addEventListener('click', onActivate);
                el.addEventListener('keydown', e => {
                    if (e.key === 'Enter' || e.key === ' ') onActivate(e);
                });
            };

            makeClickable(
                'metric-active-devices',
                () => {
                    try {
                        showSection('section-devices');
                        window.admin2?.initDevices?.();
                        setTimeout(() => {
                            try {
                                const state = window.admin2?.devicesDebug?.state;
                                if (state) {
                                    state.filterStatus = 'active';
                                    state.filterRoom = null;
                                    state.query = '';
                                }
                                window.admin2?.devicesDebug?.render?.();
                            } catch (_) {}
                        }, 0);
                    } catch (_) {}
                },
                'View active devices'
            );

            makeClickable(
                'metric-offline-devices',
                () => {
                    try {
                        showSection('section-devices');
                        window.admin2?.initDevices?.();
                        setTimeout(() => {
                            try {
                                const state = window.admin2?.devicesDebug?.state;
                                if (state) {
                                    state.filterStatus = 'offline';
                                    state.filterRoom = null;
                                    state.query = '';
                                }
                                window.admin2?.devicesDebug?.render?.();
                            } catch (_) {}
                        }, 0);
                    } catch (_) {}
                },
                'View offline devices'
            );

            makeClickable(
                'metric-media-items',
                () => {
                    try {
                        showSection('section-media-sources');
                        const section = document.getElementById('section-media-sources');
                        if (section) {
                            section
                                .querySelectorAll('section.panel')
                                .forEach(p => (p.hidden = p.id !== 'panel-sources-overview'));
                        }
                    } catch (_) {}
                },
                'View media sources overview'
            );

            makeClickable(
                'metric-mode',
                () => {
                    try {
                        showSection('section-display');
                        // Ensure the display section is initialized and mode badges reflect state
                        if (!window.__displayInit) {
                            // Lazy init if available
                            try {
                                window.admin2?.initDisplaySection?.();
                            } catch (_) {}
                        }
                    } catch (_) {}
                },
                'Open Display settings'
            );
        } catch (_) {
            /* isolated wiring: do not throw */
        }
    }

    // Update confirmation modal (theme-demo style)
    async function openUpdateModal() {
        const overlay = document.getElementById('modal-update');
        const content = document.getElementById('modal-update-content');
        const btnConfirm = document.getElementById('btn-update-confirm');
        const btnForce = document.getElementById('btn-update-force');
        if (!overlay || !content || !btnConfirm) return;
        btnConfirm.disabled = true;
        btnForce.style.display = 'none';
        content.innerHTML = '<div class="subtle">Loading update information…</div>';
        overlay.classList.add('open');

        try {
            const r = await fetch('/api/admin/update-check', { credentials: 'include' });
            const j = r.ok ? await r.json() : null;
            const hasUpdate = !!j?.hasUpdate;
            const current = j?.currentVersion || '—';
            const latest = j?.latestVersion || '—';
            const notes = j?.releaseNotes;
            if (!hasUpdate) {
                content.innerHTML = `
                                        <div style="text-align:center;">
                                            <i class="fas fa-check-circle" style="color:#34d399;font-size:2rem;margin-bottom:8px;"></i>
                                            <div>Already up to date (v${current})</div>
                                        </div>
                                        <div style="margin-top:10px; padding:10px; border:1px solid rgba(255,193,7,0.25); background:rgba(255,193,7,0.08); border-radius:8px;">
                                            <div style="color:#fbbf24; font-weight:600; margin-bottom:6px;"><i class="fas fa-hammer"></i> Repair / Force Reinstall</div>
                                            <div class="subtle">Use Force Update to repair your installation even if you're on the latest version.</div>
                                        </div>`;
                btnConfirm.disabled = true;
                btnConfirm.querySelector('span').textContent = 'No Update Needed';
                btnForce.style.display = '';
            } else {
                content.innerHTML = `
                  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
                    <div style="text-align:center; padding:10px; background: rgba(255,255,255,0.05); border-radius:8px;">
                      <div class="subtle">Current</div>
                      <div style="font-weight:700;">v${current}</div>
                    </div>
                    <div style="text-align:center; padding:10px; background: rgba(34,197,94,0.1); border:1px solid rgba(34,197,94,0.3); border-radius:8px;">
                      <div style="color:#34d399;">Available</div>
                      <div style="font-weight:700;">v${latest}</div>
                    </div>
                  </div>
                  ${notes ? `<div style="max-height:160px;overflow:auto; padding:10px; border:1px solid rgba(255,255,255,0.1); border-radius:8px;"><div class="subtle" style="margin-bottom:6px;">Release notes</div><div style="white-space:pre-wrap;">${notes}</div></div>` : ''}
                `;
                btnConfirm.disabled = false;
                btnConfirm.querySelector('span').textContent = `Update to v${latest}`;
                btnForce.style.display = '';
            }

            // Wire buttons one-time per open
            // Reset buttons to clear prior listeners
            btnConfirm.replaceWith(btnConfirm.cloneNode(true));
            btnForce.replaceWith(btnForce.cloneNode(true));
            const freshConfirm = document.getElementById('btn-update-confirm');
            const freshForce = document.getElementById('btn-update-force');
            freshConfirm?.addEventListener(
                'click',
                async () => {
                    await startUpdate(false);
                },
                { once: true }
            );
            freshForce?.addEventListener(
                'click',
                async () => {
                    await startUpdate(true);
                },
                { once: true }
            );
        } catch (e) {
            content.innerHTML = '<div class="subtle">Failed to load update info</div>';
            btnConfirm.disabled = true;
        }
    }

    async function startUpdate(force = false) {
        const btn = document.getElementById(force ? 'btn-update-force' : 'btn-update-confirm');
        const overlay = document.getElementById('modal-update');
        try {
            btn?.classList.add('btn-loading');
            const r = await fetch('/api/admin/update/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ force }),
                credentials: 'include',
            });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j?.error || 'Failed to start update');
            overlay?.classList.remove('open');
            window.notify?.toast({
                type: 'info',
                title: 'Updating…',
                message: j?.message || 'Auto-update started',
                duration: 0,
            });
            // Begin polling status; UI hook will pick it up
            // eslint-disable-next-line no-undef
            await pollUpdateStatusOnce();
        } catch (e) {
            window.notify?.toast({
                type: 'error',
                title: 'Update failed',
                message: e?.message || 'Unable to start update',
                duration: 5000,
            });
        } finally {
            btn?.classList.remove('btn-loading');
        }
    }

    // Server Settings + Promobox save + Media Sources wiring
    document.addEventListener('DOMContentLoaded', () => {
        // Ensure all interactive UI handlers (including sidebar nav) are wired
        try {
            typeof wireEvents === 'function' && wireEvents();
        } catch (e) {
            try {
                console.warn('wireEvents() init failed', e);
            } catch (_) {}
        }
        // Always wire dashboard metric shortcuts
        try {
            wireDashboardMetricShortcuts();
        } catch (_) {}
        const btnSaveServer = document.getElementById('btn-save-server-settings');
        const btnSavePromo = document.getElementById('btn-save-promobox');
        const btnSaveOps = document.getElementById('btn-save-operations');
        // Sync insecure HTTPS toggles (header and form)
        const jfInsecureForm = document.getElementById('jf.insecureHttps');
        const jfInsecureHeader = document.getElementById('jf.insecureHttpsHeader');
        if (jfInsecureForm && jfInsecureHeader) {
            const syncPair = (src, dest) => {
                if (dest && dest.checked !== src.checked) dest.checked = src.checked;
            };
            jfInsecureForm.addEventListener('change', () =>
                syncPair(jfInsecureForm, jfInsecureHeader)
            );
            jfInsecureHeader.addEventListener('change', () =>
                syncPair(jfInsecureHeader, jfInsecureForm)
            );
        }
        const portInput = document.getElementById('SERVER_PORT');
        // Helper to fetch config, patch minimal keys, and POST back
        async function saveConfigPatch(patchConfig, patchEnv) {
            // Only send the env keys we intend to change to avoid overwriting secrets with booleans
            const r = await fetch('/api/admin/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ config: patchConfig, env: patchEnv || {} }),
            });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j?.error || j?.message || 'Save failed');
            // Invalidate any cached GET of /api/admin/config so subsequent reloads see fresh data
            try {
                if (typeof miniCache?.delete === 'function')
                    miniCache.delete('/api/admin/config|GET');
                if (typeof inflight?.delete === 'function')
                    inflight.delete('/api/admin/config|GET');
            } catch (_) {
                /* no-op */
            }
            return j;
        }

        // Helpers for Media Sources
        const getInput = id => document.getElementById(id);
        const toInt = v => {
            const n = Number(v);
            return Number.isFinite(n) ? n : undefined;
        };
        // Parse a year expression like "2010, 2011, 1998, 1910-1920" to a canonical string
        function parseYearExpression(input) {
            const raw = String(input || '').trim();
            if (!raw) return undefined;
            const parts = raw
                .split(',')
                .map(s => s.trim())
                .filter(Boolean);
            const tokens = [];
            const yearRe = /^\d{4}$/;
            const rangeRe = /^(\d{4})\s*-\s*(\d{4})$/;
            for (const p of parts) {
                const y = p.match(yearRe);
                if (y) {
                    const year = Number(y[0]);
                    if (year >= 1900) tokens.push(String(year));
                    continue;
                }
                const r = p.match(rangeRe);
                if (r) {
                    const a = Number(r[1]);
                    const b = Number(r[2]);
                    if (a >= 1900 && b >= 1900 && b >= a) tokens.push(`${a}-${b}`);
                    continue;
                }
                // ignore invalid piece
            }
            if (!tokens.length) return undefined;
            return tokens.join(', ');
        }
        function setMultiSelect(id, options, selected) {
            const sel = getInput(id);
            if (!sel) return;
            const prev = new Set(Array.from(sel.selectedOptions).map(o => o.value));
            sel.innerHTML = '';
            const chosen = new Set(selected || Array.from(prev));
            (options || []).forEach(opt => {
                const o = document.createElement('option');
                o.value = opt.value ?? opt.name ?? opt;
                o.textContent = opt.label ?? opt.name ?? String(opt);
                if (opt.count != null) o.textContent += ` (${opt.count})`;
                if (chosen.has(o.value)) o.selected = true;
                sel.appendChild(o);
            });
        }
        function getMultiSelectValues(id) {
            const sel = getInput(id);
            if (!sel) return [];
            return Array.from(sel.selectedOptions).map(o => o.value);
        }
        function parseCsvList(str) {
            return String(str || '')
                .split(',')
                .map(s => s.trim())
                .filter(Boolean);
        }

        // ----- Media Sources Overview (cards) -----
        // Update a single card's dot/pill status
        function setCardStatus(prefix, { enabled, configured, pillText }) {
            try {
                const dot = document.getElementById(`${prefix}-dot`);
                const pill = document.getElementById(`${prefix}-pill`);
                const cls = !enabled ? 'error' : configured ? 'success' : 'warning';
                if (dot) {
                    dot.classList.remove('status-success', 'status-warning', 'status-error');
                    dot.classList.add(`status-${cls}`);
                }
                if (pill) {
                    pill.textContent =
                        pillText ||
                        (configured ? 'Configured' : enabled ? 'Not configured' : 'Disabled');
                    pill.classList.remove('status-success', 'status-warning', 'status-error');
                    pill.classList.add(`status-${cls}`);
                }
            } catch (_) {
                /* no-op */
            }
        }

        async function patchSourceEnabled(sourceKey, enabled) {
            try {
                const cfgRes = await window.dedupJSON('/api/admin/config', {
                    credentials: 'include',
                });
                const base = cfgRes.ok ? await cfgRes.json() : {};
                const currentCfg = base?.config || base || {};
                const envPatch = {}; // no env changes for toggle

                if (sourceKey === 'plex' || sourceKey === 'jellyfin') {
                    const servers = Array.isArray(currentCfg.mediaServers)
                        ? [...currentCfg.mediaServers]
                        : [];
                    const idx = servers.findIndex(s => s?.type === sourceKey);
                    const s = idx >= 0 ? { ...servers[idx] } : { type: sourceKey };
                    s.enabled = !!enabled;
                    if (idx >= 0) servers[idx] = s;
                    else servers.push(s);
                    await saveConfigPatch({ mediaServers: servers }, envPatch);
                } else if (sourceKey === 'tmdb') {
                    const tmdb = { ...(currentCfg.tmdbSource || {}) };
                    tmdb.enabled = !!enabled;
                    await saveConfigPatch({ tmdbSource: tmdb }, envPatch);
                } else if (sourceKey === 'tvdb') {
                    const tvdb = { ...(currentCfg.tvdbSource || {}) };
                    tvdb.enabled = !!enabled;
                    await saveConfigPatch({ tvdbSource: tvdb }, envPatch);
                }
                window.notify?.toast({
                    type: 'success',
                    title: 'Saved',
                    message: `${sourceKey.toUpperCase()} ${enabled ? 'enabled' : 'disabled'}`,
                    duration: 1800,
                });
                return true;
            } catch (e) {
                window.notify?.toast({
                    type: 'error',
                    title: 'Save failed',
                    message: e?.message || 'Unable to save setting',
                    duration: 4200,
                });
                return false;
            }
        }

        function wireToggleOnce(id, handler) {
            const el = document.getElementById(id);
            if (!el || el.dataset.wired === 'true') return;
            el.addEventListener('change', handler);
            el.dataset.wired = 'true';
        }

        function updateOverviewCards(cfg, env) {
            try {
                const mediaServers = Array.isArray(cfg?.mediaServers) ? cfg.mediaServers : [];
                const plex = mediaServers.find(s => s?.type === 'plex') || {};
                const jf = mediaServers.find(s => s?.type === 'jellyfin') || {};
                const tmdb = cfg?.tmdbSource || {};
                const tvdb = cfg?.tvdbSource || {};

                // Plex
                try {
                    const enabled = !!plex.enabled;
                    const hostVar = plex.hostnameEnvVar || 'PLEX_HOSTNAME';
                    const portVar = plex.portEnvVar || 'PLEX_PORT';
                    const tokenVar = plex.tokenEnvVar || 'PLEX_TOKEN';
                    const host = env[hostVar];
                    const port = env[portVar];
                    const tokenVal = env[tokenVar]; // may be boolean true if sensitive
                    const hasToken = !!tokenVal; // cope with boolean masked value
                    const configured = !!(host && port && hasToken);
                    setCardStatus('sc-plex', {
                        enabled,
                        configured,
                        pillText: !enabled
                            ? 'Disabled'
                            : configured
                              ? 'Configured'
                              : 'Not configured',
                    });
                    const libMovie = Array.isArray(plex.movieLibraryNames)
                        ? plex.movieLibraryNames.length
                        : 0;
                    const libShow = Array.isArray(plex.showLibraryNames)
                        ? plex.showLibraryNames.length
                        : 0;
                    const libsEl = document.getElementById('sc-plex-libs');
                    if (libsEl) {
                        const v = libsEl.querySelector('.value');
                        if (v) v.textContent = `${libMovie + libShow}`;
                        libsEl.title = `Libraries selected: Movies ${libMovie}, Shows ${libShow}`;
                    }
                    const tgl = document.getElementById('sc.plex.enabled');
                    if (tgl) tgl.checked = enabled;
                    wireToggleOnce('sc.plex.enabled', async e => {
                        const el = e.currentTarget;
                        el.disabled = true;
                        const ok = await patchSourceEnabled('plex', !!el.checked);
                        if (!ok) el.checked = !el.checked;
                        el.disabled = false;
                        // Mirror panel toggle if present
                        const mirror = document.getElementById('plex.enabled');
                        if (mirror) mirror.checked = el.checked;
                        loadMediaSources(true).catch(() => {});
                    });
                } catch (_) {}

                // Jellyfin
                try {
                    const enabled = !!jf.enabled;
                    const hostVar = jf.hostnameEnvVar || 'JELLYFIN_HOSTNAME';
                    const portVar = jf.portEnvVar || 'JELLYFIN_PORT';
                    const keyVar = jf.tokenEnvVar || 'JELLYFIN_API_KEY';
                    const host = env[hostVar];
                    const port = env[portVar];
                    const keyVal = env[keyVar];
                    const hasKey = !!keyVal; // maybe boolean masked
                    const configured = !!(host && port && hasKey);
                    setCardStatus('sc-jf', {
                        enabled,
                        configured,
                        pillText: !enabled
                            ? 'Disabled'
                            : configured
                              ? 'Configured'
                              : 'Not configured',
                    });
                    const libMovie = Array.isArray(jf.movieLibraryNames)
                        ? jf.movieLibraryNames.length
                        : 0;
                    const libShow = Array.isArray(jf.showLibraryNames)
                        ? jf.showLibraryNames.length
                        : 0;
                    const libsEl = document.getElementById('sc-jf-libs');
                    if (libsEl) {
                        const v = libsEl.querySelector('.value');
                        if (v) v.textContent = `${libMovie + libShow}`;
                        libsEl.title = `Libraries selected: Movies ${libMovie}, Shows ${libShow}`;
                    }
                    const tgl = document.getElementById('sc.jf.enabled');
                    if (tgl) tgl.checked = enabled;
                    wireToggleOnce('sc.jf.enabled', async e => {
                        const el = e.currentTarget;
                        el.disabled = true;
                        const ok = await patchSourceEnabled('jellyfin', !!el.checked);
                        if (!ok) el.checked = !el.checked;
                        el.disabled = false;
                        const mirror = document.getElementById('jf.enabled');
                        if (mirror) mirror.checked = el.checked;
                        loadMediaSources(true).catch(() => {});
                    });
                } catch (_) {}

                // TMDB
                try {
                    const enabled = !!tmdb.enabled;
                    const configured = !!tmdb.apiKey;
                    setCardStatus('sc-tmdb', {
                        enabled,
                        configured,
                        pillText: !enabled
                            ? 'Disabled'
                            : configured
                              ? 'Configured'
                              : 'Not configured',
                    });
                    const modeEl = document.getElementById('sc-tmdb-mode');
                    if (modeEl) {
                        const v = modeEl.querySelector('.value');
                        if (v) v.textContent = `${tmdb.category || 'popular'}`;
                        modeEl.title = `Category: ${tmdb.category || 'popular'}`;
                    }
                    const tgl = document.getElementById('sc.tmdb.enabled');
                    if (tgl) tgl.checked = enabled;
                    wireToggleOnce('sc.tmdb.enabled', async e => {
                        const el = e.currentTarget;
                        el.disabled = true;
                        const ok = await patchSourceEnabled('tmdb', !!el.checked);
                        if (!ok) el.checked = !el.checked;
                        el.disabled = false;
                        const mirror = document.getElementById('tmdb.enabled');
                        if (mirror) mirror.checked = el.checked;
                        loadMediaSources(true).catch(() => {});
                    });
                } catch (_) {}

                // TVDB
                try {
                    const enabled = !!tvdb.enabled;
                    // No API key required in our config model; treat configured as enabled
                    setCardStatus('sc-tvdb', {
                        enabled,
                        configured: enabled,
                        pillText: enabled ? 'Configured' : 'Disabled',
                    });
                    const tgl = document.getElementById('sc.tvdb.enabled');
                    if (tgl) tgl.checked = enabled;
                    wireToggleOnce('sc.tvdb.enabled', async e => {
                        const el = e.currentTarget;
                        el.disabled = true;
                        const ok = await patchSourceEnabled('tvdb', !!el.checked);
                        if (!ok) el.checked = !el.checked;
                        el.disabled = false;
                        const mirror = document.getElementById('tvdb.enabled');
                        if (mirror) mirror.checked = el.checked;
                        // Repaint header pills and dependent UI
                        loadMediaSources(true).catch(() => {});
                    });
                } catch (_) {}
            } catch (_) {
                /* non-fatal */
            }
        }

        async function refreshOverviewLastSync() {
            try {
                const r = await window.dedupJSON('/api/admin/source-status', {
                    credentials: 'include',
                });
                if (!r.ok) return;
                const j = await r.json();
                const fmt = ms => {
                    if (!ms || typeof ms !== 'number') return '—';
                    const d = new Date(ms);
                    if (Number.isNaN(d.getTime())) return '—';
                    // Show relative first, with ISO title for exact time
                    const now = Date.now();
                    const diff = Math.max(0, now - ms);
                    const mins = Math.floor(diff / 60000);
                    if (mins < 1) return 'just now';
                    if (mins < 60) return `${mins} min ago`;
                    const hrs = Math.floor(mins / 60);
                    if (hrs < 24) return `${hrs} hr${hrs === 1 ? '' : 's'} ago`;
                    const days = Math.floor(hrs / 24);
                    return `${days} day${days === 1 ? '' : 's'} ago`;
                };
                const setSync = (id, ms) => {
                    const el = document.getElementById(id);
                    if (!el) return;
                    const v = el.querySelector('.value');
                    const pretty = fmt(ms);
                    if (v) v.textContent = pretty;
                    if (ms && typeof ms === 'number') {
                        const iso = new Date(ms).toISOString();
                        el.title = `Last sync: ${pretty} (exact: ${iso})`;
                    } else {
                        el.title = 'Last sync: —';
                    }
                };
                setSync('sc-plex-sync', j?.plex?.lastFetchMs || null);
                setSync('sc-jf-sync', j?.jellyfin?.lastFetchMs || null);
                setSync('sc-tmdb-sync', j?.tmdb?.lastFetchMs || null);
                setSync('sc-tvdb-sync', j?.tvdb?.lastFetchMs || null);
            } catch (_) {
                // ignore
            }
        }

        // Simple in-memory cache for library counts to avoid spamming admin APIs
        const __libCountsCache = {
            ts: 0,
            plex: null,
            jf: null,
        };

        async function fetchLibraryCounts(kind) {
            const now = Date.now();
            // Reuse cache for 15s
            if (now - __libCountsCache.ts < 15000 && __libCountsCache[kind]) {
                return __libCountsCache[kind];
            }
            try {
                let res;
                if (kind === 'plex') {
                    // Use current UI values if present (even if not yet saved)
                    const hostname = document.getElementById('plex.hostname')?.value?.trim();
                    const port = document.getElementById('plex.port')?.value?.trim();
                    const token = document.getElementById('plex.token')?.value?.trim();
                    res = await fetch('/api/admin/plex-libraries', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({
                            hostname: hostname || undefined,
                            port: port || undefined,
                            token: token || undefined,
                        }),
                    });
                } else if (kind === 'jf' || kind === 'jellyfin') {
                    const hostname = document.getElementById('jf.hostname')?.value?.trim();
                    const port = document.getElementById('jf.port')?.value?.trim();
                    const apiKey = document.getElementById('jf.apikey')?.value?.trim();
                    res = await fetch('/api/admin/jellyfin-libraries', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({
                            hostname: hostname || undefined,
                            port: port || undefined,
                            apiKey: apiKey || undefined,
                        }),
                    });
                }
                const j = res && res.ok ? await res.json().catch(() => ({})) : {};
                const libs = Array.isArray(j.libraries) ? j.libraries : [];
                const byName = new Map();
                for (const l of libs) {
                    byName.set(l.name, { type: l.type, itemCount: Number(l.itemCount) || 0 });
                }
                __libCountsCache[kind] = byName;
                __libCountsCache.ts = now;
                return byName;
            } catch (_) {
                return new Map();
            }
        }

        function getSelectedLibraries(kind) {
            // kind: 'plex' | 'jellyfin'
            if (kind === 'plex') {
                return {
                    movies: getMultiSelectValues('plex.movies'),
                    shows: getMultiSelectValues('plex.shows'),
                };
            }
            return {
                movies: getMultiSelectValues('jf.movies'),
                shows: getMultiSelectValues('jf.shows'),
            };
        }

        function isAnyFilterActive(filters) {
            return (
                !!(filters.years && filters.years.trim()) ||
                !!(filters.genres && filters.genres.trim()) ||
                !!(filters.ratings && filters.ratings.trim()) ||
                !!(filters.qualities && filters.qualities.trim()) ||
                !!(filters.recentOnly && filters.recentDays > 0)
            );
        }

        // Compute live filtered counts per source; when filters are active, use server-side uncapped preview
        async function refreshOverviewCounts() {
            try {
                // Fetch cached playlist first (fast fallback & used when no filters)
                const res = await window.dedupJSON('/get-media', { credentials: 'include' });
                let items = [];
                if (res) {
                    if (res.status === 202) {
                        // Playlist building; schedule a quick retry so counts don't stick at 0
                        const j = (await res.json().catch(() => ({}))) || {};
                        const retryIn = Math.min(Math.max(Number(j.retryIn) || 2000, 500), 5000);
                        setTimeout(() => {
                            try {
                                refreshOverviewCounts();
                            } catch (_) {}
                        }, retryIn);
                    } else if (res.ok) {
                        items = (await res.json().catch(() => [])) || [];
                        if (!Array.isArray(items)) items = [];
                    }
                }

                // Helpers: infer source and apply UI filters
                const inferSource = it => {
                    const s = (it.source || it.serverType || '').toString().toLowerCase();
                    if (s) return s;
                    // Best-effort inference for TMDB/TVDB items that may not set source string
                    if (it.tmdbId != null) return 'tmdb';
                    if (it.tvdbId != null) return 'tvdb';
                    const k = (it.key || '').toString().toLowerCase();
                    if (k.startsWith('plex-')) return 'plex';
                    if (k.startsWith('jellyfin_')) return 'jellyfin';
                    if (k.startsWith('tmdb-')) return 'tmdb';
                    if (k.startsWith('tvdb-')) return 'tvdb';
                    return '';
                };
                const parseCsv = v =>
                    String(v || '')
                        .split(',')
                        .map(s => s.trim())
                        .filter(Boolean);
                const yearInExpr = (year, expr) => {
                    if (!expr) return true;
                    const y = Number(year);
                    if (!Number.isFinite(y) || y <= 0) return false;
                    const parts = String(expr)
                        .split(',')
                        .map(s => s.trim())
                        .filter(Boolean);
                    for (const p of parts) {
                        if (/^\d{4}$/.test(p)) {
                            if (y === Number(p)) return true;
                        } else {
                            const m = p.match(/^(\d{4})\s*-\s*(\d{4})$/);
                            if (m) {
                                const a = Number(m[1]);
                                const b = Number(m[2]);
                                if (Number.isFinite(a) && Number.isFinite(b) && a <= b) {
                                    if (y >= a && y <= b) return true;
                                }
                            }
                        }
                    }
                    return false;
                };
                const anyGenreMatch = (itemGenres, selectedCsv) => {
                    const need = parseCsv(selectedCsv);
                    if (!need.length) return true;
                    const have = Array.isArray(itemGenres)
                        ? itemGenres.map(g => String(g).toLowerCase())
                        : [];
                    return need.some(n => have.includes(String(n).toLowerCase()));
                };
                const ratingIncluded = (itemRating, selectedCsv) => {
                    const need = parseCsv(selectedCsv);
                    if (!need.length) return true;
                    if (!itemRating) return false;
                    const norm = String(itemRating).toLowerCase();
                    return need.some(r => String(r).toLowerCase() === norm);
                };
                // Map backend resolution strings to quality labels like the server does
                const mapResToLabel = res => {
                    const r = (res || '').toString().toLowerCase();
                    if (!r || r === 'sd') return 'SD';
                    if (r === '720' || r === 'hd' || r === '720p') return '720p';
                    if (r === '1080' || r === '1080p' || r === 'fullhd') return '1080p';
                    if (r === '4k' || r === '2160' || r === '2160p' || r === 'uhd') return '4K';
                    return r.toUpperCase();
                };
                // Try to infer Jellyfin quality label from originalData MediaStreams
                const inferJfQuality = it => {
                    const od = it && (it.originalData || it._raw);
                    const sources = od && Array.isArray(od.MediaSources) ? od.MediaSources : [];
                    for (const source of sources) {
                        const streams = Array.isArray(source.MediaStreams)
                            ? source.MediaStreams
                            : [];
                        const vid = streams.find(s => s.Type === 'Video');
                        if (vid && Number.isFinite(Number(vid.Height))) {
                            const h = Number(vid.Height);
                            if (h <= 576) return 'SD';
                            if (h <= 720) return '720p';
                            if (h <= 1080) return '1080p';
                            if (h >= 2160) return '4K';
                            return `${h}p`;
                        }
                    }
                    return null;
                };
                // Try to infer Plex quality label from raw Media videoResolution when available
                const inferPlexQuality = it => {
                    const raw = it && it._raw;
                    const mediaArr = raw && Array.isArray(raw.Media) ? raw.Media : [];
                    for (const m of mediaArr) {
                        if (m && m.videoResolution) return mapResToLabel(m.videoResolution);
                    }
                    return null;
                };

                // Read current UI filters (live, unsaved)
                const plexFilters = {
                    years: (document.getElementById('plex.yearFilter')?.value || '').trim(),
                    genres: (typeof getPlexGenreFilterHidden === 'function'
                        ? getPlexGenreFilterHidden()
                        : ''
                    ).trim(),
                    // MPAA/TV ratings
                    ratings: (typeof getPlexHidden === 'function'
                        ? getPlexHidden('plex.ratingFilter-hidden')
                        : ''
                    ).trim(),
                    qualities: (typeof getPlexHidden === 'function'
                        ? getPlexHidden('plex.qualityFilter-hidden')
                        : ''
                    ).trim(),
                    recentOnly: !!document.getElementById('plex.recentOnly')?.checked,
                    recentDays: Number(document.getElementById('plex.recentDays')?.value) || 0,
                };
                const jfFilters = {
                    years: (document.getElementById('jf.yearFilter')?.value || '').trim(),
                    genres: (typeof getJfHidden === 'function'
                        ? getJfHidden('jf.genreFilter-hidden')
                        : ''
                    ).trim(),
                    ratings: (typeof getJfHidden === 'function'
                        ? getJfHidden('jf.ratingFilter-hidden')
                        : ''
                    ).trim(),
                    qualities: (typeof getJfHidden === 'function'
                        ? getJfHidden('jf.qualityFilter-hidden')
                        : ''
                    ).trim(),
                    recentOnly: !!document.getElementById('jf.recentOnly')?.checked,
                    recentDays: Number(document.getElementById('jf.recentDays')?.value) || 0,
                };

                const matchWith = (it, src) => {
                    const s = inferSource(it);
                    if (s !== src) return false;
                    const f = src === 'plex' ? plexFilters : src === 'jellyfin' ? jfFilters : null;
                    if (!f) return true;
                    // Year
                    if (f.years && !yearInExpr(it.year, f.years)) return false;
                    // Genres
                    if (!anyGenreMatch(it.genres, f.genres)) return false;
                    // Content rating (MPAA/TV)
                    const itemRating = src === 'plex' ? it.contentRating : it.officialRating;
                    if (!ratingIncluded(itemRating, f.ratings)) return false;
                    // Quality (best-effort; skip when unknown on item)
                    const allowedQ = parseCsv(f.qualities);
                    if (allowedQ.length) {
                        // Prefer explicit qualityLabel when present (set by backend), else infer
                        const qLabel = (it.qualityLabel || '').toString();
                        const q = qLabel
                            ? qLabel
                            : src === 'plex'
                              ? inferPlexQuality(it)
                              : inferJfQuality(it);
                        if (q) {
                            const allowedLower = allowedQ.map(a => a.toLowerCase());
                            if (!allowedLower.includes(q.toLowerCase())) return false;
                        }
                    }
                    // Recently added only
                    if (f.recentOnly && f.recentDays > 0) {
                        const ts = Number(it.addedAtMs);
                        if (!Number.isFinite(ts)) return false;
                        const daysAgo = Date.now() - f.recentDays * 24 * 60 * 60 * 1000;
                        if (ts < daysAgo) return false;
                    }
                    return true;
                };

                const setCount = (id, n, m, tooltip) => {
                    const el = document.getElementById(id);
                    if (!el) return;
                    const valEl = el.querySelector('.value');
                    // Always show a number (fallback to 0) to avoid lingering em-dash
                    const nn = Number.isFinite(n) ? n : 0;
                    const mm = Number.isFinite(m) ? m : m === 0 ? 0 : null;
                    if (valEl) {
                        valEl.textContent = mm != null ? `${nn}/${mm}` : `${nn}`;
                    } else {
                        // Fallback for header pills without inner .value span
                        el.textContent = mm != null ? `Items: ${nn} of ${mm}` : `Items: ${nn}`;
                    }
                    if (typeof tooltip === 'string' && tooltip) el.title = tooltip;
                };
                // Compute filtered counts from playlist cache (fallback)
                let filteredPlex = items.filter(it => matchWith(it, 'plex')).length;
                let filteredJf = items.filter(it => matchWith(it, 'jellyfin')).length;
                // For TMDB/TVDB we don't have per-source filters here; show counts from cached playlist
                const filteredTmdb = items.filter(it => inferSource(it) === 'tmdb').length;
                const filteredTvdb = items.filter(it => inferSource(it) === 'tvdb').length;

                // Always ask the server for full-library uncapped counts to ensure Plex/JF filters reflect immediately
                try {
                    const body = {
                        plex: getSelectedLibraries('plex'),
                        jellyfin: getSelectedLibraries('jellyfin'),
                        // Send filters per source, matching server-side logic
                        filtersPlex: plexFilters,
                        filtersJellyfin: jfFilters,
                    };
                    const r = await fetch('/api/admin/filter-preview', {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body),
                    });
                    if (r.ok) {
                        const j = await r.json().catch(() => ({}));
                        const c = j?.counts || {};
                        if (Number.isFinite(c.plex)) filteredPlex = c.plex;
                        if (Number.isFinite(c.jellyfin)) filteredJf = c.jellyfin;
                    }
                } catch (_) {
                    // ignore and fall back to cached playlist derived counts
                }

                // Always compute true totals (sum of selected library counts)
                let totalPlex = null;
                let totalJf = null;
                try {
                    const map = await fetchLibraryCounts('plex');
                    const { movies, shows } = getSelectedLibraries('plex');
                    const sum = arr =>
                        (arr || []).reduce((acc, name) => acc + (map.get(name)?.itemCount || 0), 0);
                    totalPlex = sum(movies) + sum(shows);
                } catch (_) {}
                try {
                    const map = await fetchLibraryCounts('jellyfin');
                    const { movies, shows } = getSelectedLibraries('jellyfin');
                    const sum = arr =>
                        (arr || []).reduce((acc, name) => acc + (map.get(name)?.itemCount || 0), 0);
                    totalJf = sum(movies) + sum(shows);
                } catch (_) {}

                // If no filters are active, prefer true totals; if unavailable, fall back to filtered (playlist-derived)
                // Determine whether any filters are currently active (for display preference only)
                const plexFiltersActive = isAnyFilterActive(plexFilters);
                const jfFiltersActive = isAnyFilterActive(jfFilters);
                const displayPlex = plexFiltersActive
                    ? filteredPlex
                    : Number.isFinite(totalPlex)
                      ? totalPlex
                      : filteredPlex;
                const displayJf = jfFiltersActive
                    ? filteredJf
                    : Number.isFinite(totalJf)
                      ? totalJf
                      : filteredJf;

                const _fmt = v => (Number.isFinite(v) ? Number(v).toLocaleString() : '—');
                const plexTooltip = `Items — filtered: ${_fmt(filteredPlex)} | total: ${_fmt(totalPlex)}`;
                const jfTooltip = `Items — filtered: ${_fmt(filteredJf)} | total: ${_fmt(totalJf)}`;
                setCount('sc-plex-count', displayPlex, totalPlex, plexTooltip);
                setCount('sc-jf-count', displayJf, totalJf, jfTooltip);
                // Default display for TMDB/TVDB from cached playlist (X)
                let tmdbTotal = null;
                let tvdbTotal = null;
                let tvdbAvailable = null;
                try {
                    const r = await window.dedupJSON('/api/admin/tmdb-total', {
                        credentials: 'include',
                    });
                    if (r?.ok) {
                        const j = await r.json();
                        const tv = j?.total;
                        if (typeof tv === 'number' && Number.isFinite(tv)) tmdbTotal = tv;
                        else if (typeof tv === 'string' && /^\d+$/.test(tv))
                            tmdbTotal = parseInt(tv, 10);
                    }
                } catch (_) {}
                try {
                    const r = await window.dedupJSON('/api/admin/tvdb-total', {
                        credentials: 'include',
                    });
                    if (r?.ok) {
                        const j = await r.json();
                        const tv = j?.total;
                        if (typeof tv === 'number' && Number.isFinite(tv)) tvdbTotal = tv;
                        else if (typeof tv === 'string' && /^\d+$/.test(tv))
                            tvdbTotal = parseInt(tv, 10);
                        else tvdbTotal = null; // Unknown
                    }
                } catch (_) {}
                try {
                    const r = await window.dedupJSON('/api/admin/tvdb-available', {
                        credentials: 'include',
                    });
                    if (r?.ok) {
                        const j = await r.json();
                        const av = j?.available;
                        if (typeof av === 'number' && Number.isFinite(av)) tvdbAvailable = av;
                        else if (typeof av === 'string' && /^\d+$/.test(av))
                            tvdbAvailable = parseInt(av, 10);
                    }
                } catch (_) {}

                // Display counts: for TMDB/TVDB we don't have UI filters, so show a single total number.
                const displayTmdb = Number.isFinite(tmdbTotal) ? tmdbTotal : filteredTmdb;
                const displayTvdb = Number.isFinite(tvdbTotal)
                    ? tvdbTotal
                    : Number.isFinite(tvdbAvailable)
                      ? tvdbAvailable
                      : filteredTvdb;

                // Build helpful tooltips for TMDB/TVDB
                const fmt = v => (Number.isFinite(v) ? Number(v).toLocaleString() : '—');
                const tmdbTooltip = `TMDB items — cached: ${fmt(filteredTmdb)} | total: ${fmt(tmdbTotal)}`;
                const tvdbTooltip = `TVDB items — cached: ${fmt(filteredTvdb)} | available: ${fmt(tvdbAvailable)}`;

                // Overview tiles
                setCount('sc-tmdb-count', displayTmdb, null, tmdbTooltip);
                setCount('sc-tvdb-count', displayTvdb, null, tvdbTooltip);
                // Also update per-source panel header pills
                setCount('plex-count-pill', displayPlex, totalPlex);
                setCount('jf-count-pill', displayJf, totalJf);
                // TMDB/TVDB header pills (single total)
                setCount('tmdb-count-pill', displayTmdb, null, tmdbTooltip);
                setCount('tvdb-count-pill', displayTvdb, null, tvdbTooltip);
            } catch (_) {
                // ignore
            }
        }

        // Wire live listeners so count badges and library labels update while editing
        function wireLiveMediaSourcePreview() {
            try {
                if (document.body.dataset.msPreviewWired === 'true') return;
                const safeOn = (id, evt = 'change') => {
                    const el = document.getElementById(id);
                    if (!el) return;
                    if (el.dataset.countWired === 'true') return;
                    el.addEventListener(evt, () => refreshOverviewCounts());
                    el.dataset.countWired = 'true';
                };
                // Plex filters
                safeOn('plex.yearFilter', 'input');
                safeOn('plex.ratingFilter-hidden');
                safeOn('plex.genreFilter-hidden');
                safeOn('plex.qualityFilter-hidden');
                safeOn('plex.recentOnly');
                safeOn('plex.recentDays', 'input');
                // Toggle Plex days enabled state when checkbox changes
                try {
                    const pcb = document.getElementById('plex.recentOnly');
                    const pdy = document.getElementById('plex.recentDays');
                    if (pcb && !pcb.dataset.daysToggleWired) {
                        pcb.addEventListener('change', () => {
                            if (pdy) pdy.disabled = !pcb.checked;
                        });
                        pcb.dataset.daysToggleWired = 'true';
                    }
                } catch (_) {}
                // Jellyfin filters
                safeOn('jf.yearFilter', 'input');
                safeOn('jf.ratingFilter-hidden');
                safeOn('jf.genreFilter-hidden');
                safeOn('jf.qualityFilter-hidden');
                safeOn('jf.recentOnly');
                safeOn('jf.recentDays', 'input');
                // Toggle Jellyfin days enabled state when checkbox changes
                try {
                    const jcb = document.getElementById('jf.recentOnly');
                    const jdy = document.getElementById('jf.recentDays');
                    if (jcb && !jcb.dataset.daysToggleWired) {
                        jcb.addEventListener('change', () => {
                            if (jdy) jdy.disabled = !jcb.checked;
                        });
                        jcb.dataset.daysToggleWired = 'true';
                    }
                } catch (_) {}

                // Keep overview "Libraries: Movies X, Shows Y" in sync with current selections
                const updateLibsMeta = () => {
                    try {
                        const plexMovies = document.getElementById('plex.movies');
                        const plexShows = document.getElementById('plex.shows');
                        const jfMovies = document.getElementById('jf.movies');
                        const jfShows = document.getElementById('jf.shows');
                        const countSel = sel =>
                            sel ? Array.from(sel.selectedOptions || []).length : 0;
                        const plexLibsEl = document.getElementById('sc-plex-libs');
                        const jfLibsEl = document.getElementById('sc-jf-libs');
                        if (plexLibsEl) {
                            const v = plexLibsEl.querySelector('.value');
                            const mv = countSel(plexMovies),
                                sv = countSel(plexShows);
                            if (v) v.textContent = `${mv + sv}`;
                            plexLibsEl.title = `Libraries selected: Movies ${mv}, Shows ${sv}`;
                        }
                        if (jfLibsEl) {
                            const v = jfLibsEl.querySelector('.value');
                            const mv = countSel(jfMovies),
                                sv = countSel(jfShows);
                            if (v) v.textContent = `${mv + sv}`;
                            jfLibsEl.title = `Libraries selected: Movies ${mv}, Shows ${sv}`;
                        }
                    } catch (_) {}
                };
                const onLibChange = selId => {
                    const sel = document.getElementById(selId);
                    if (!sel) return;
                    if (sel.dataset.countWired === 'true') return;
                    sel.addEventListener('change', () => {
                        updateLibsMeta();
                        // Recompute counts too; we cannot filter by library in playlist, but keep it reactive
                        refreshOverviewCounts();
                    });
                    sel.dataset.countWired = 'true';
                };
                onLibChange('plex.movies');
                onLibChange('plex.shows');
                onLibChange('jf.movies');
                onLibChange('jf.shows');
                // Initial sync
                updateLibsMeta();
                document.body.dataset.msPreviewWired = 'true';
            } catch (_) {
                /* no-op */
            }
        }

        // Prevent autofill/auto-focus on sensitive fields; require explicit user click to edit
        function guardSensitiveInputs() {
            try {
                const ids = ['plex.token', 'jf.apikey', 'tmdb.apikey'];
                // If any of these were auto-focused by the browser, blur them immediately
                try {
                    const ae = document.activeElement;
                    if (ae && ids.includes(ae.id)) ae.blur();
                } catch (_) {}
                ids.forEach(id => {
                    const el = document.getElementById(id);
                    if (!el || el.dataset.requireClickWired === 'true') return;
                    // Make read-only until the user explicitly clicks/taps
                    el.readOnly = true;
                    el.title = el.title || 'Click to edit';
                    const unlock = () => {
                        if (!el.readOnly) return;
                        el.readOnly = false;
                        // focus after unlocking for a smooth experience
                        setTimeout(() => {
                            try {
                                el.focus({ preventScroll: true });
                            } catch (_) {}
                        }, 0);
                    };
                    // Pointer interactions unlock editing
                    el.addEventListener('mousedown', unlock);
                    el.addEventListener('touchstart', unlock, { passive: true });
                    // If the browser tries to focus without a click (e.g., autofill), immediately blur
                    el.addEventListener('focus', () => {
                        if (el.readOnly) {
                            try {
                                el.blur();
                            } catch (_) {}
                        }
                    });
                    el.dataset.requireClickWired = 'true';
                });
            } catch (_) {
                /* no-op */
            }
        }

        // Generic theme-demo multiselect (chips + dropdown) for backing <select multiple>
        function initMsForSelect(idBase, selectId) {
            const sel = document.getElementById(selectId);
            const root = document.getElementById(`${idBase}`);
            if (!sel || !root) return;
            if (root.dataset.msWired === 'true') return; // listeners already attached; use rebuildMsForSelect() to refresh options
            const control = root.querySelector('.ms-control');
            const chipsEl = root.querySelector('.ms-chips');
            const menu = document.getElementById(`${idBase}-menu`);
            const optsEl = document.getElementById(`${idBase}-options`);
            const search = document.getElementById(`${idBase}-search`);
            const clear = document.getElementById(`${idBase}-clear`);
            const selectAll = document.getElementById(`${idBase}-select-all`);
            const clearAll = document.getElementById(`${idBase}-clear-all`);
            if (!control || !chipsEl || !menu || !optsEl || !search || !selectAll || !clearAll)
                return;

            const getSelected = () => new Set(Array.from(sel.selectedOptions).map(o => o.value));
            const setSelected = valsSet => {
                const vals = new Set(valsSet);
                Array.from(sel.options).forEach(o => {
                    o.selected = vals.has(o.value);
                });
                sel.dispatchEvent(new Event('change', { bubbles: true }));
            };
            const renderChips = () => {
                const selected = getSelected();
                chipsEl.innerHTML = '';
                selected.forEach(v => {
                    const label =
                        Array.from(sel.options).find(o => o.value === v)?.textContent || v;
                    const chip = document.createElement('span');
                    chip.className = 'ms-chip';
                    chip.dataset.value = v;
                    chip.innerHTML = `${label} <i class="fas fa-xmark ms-chip-remove" title="Remove"></i>`;
                    chip.querySelector('.ms-chip-remove')?.addEventListener('click', e => {
                        e.stopPropagation();
                        const s = getSelected();
                        s.delete(v);
                        setSelected(s);
                        syncOptions();
                        renderChips();
                        control.classList.toggle('has-selection', s.size > 0);
                    });
                    chipsEl.appendChild(chip);
                });
                control.classList.toggle('has-selection', selected.size > 0);
            };
            const syncOptions = () => {
                const selected = getSelected();
                Array.from(optsEl.children).forEach(row => {
                    const v = row.dataset.value;
                    const cb = row.querySelector('input[type="checkbox"]');
                    if (cb) cb.checked = selected.has(v);
                });
            };
            const buildOptions = () => {
                optsEl.innerHTML = '';
                const items = Array.from(sel.options).map(o => ({
                    value: o.value,
                    label: o.textContent,
                }));
                items.forEach(it => {
                    const row = document.createElement('div');
                    row.className = 'ms-option';
                    row.dataset.value = it.value;
                    const cb = document.createElement('input');
                    cb.type = 'checkbox';
                    const span = document.createElement('span');
                    span.textContent = it.label;
                    row.appendChild(cb);
                    row.appendChild(span);
                    optsEl.appendChild(row);
                });
                syncOptions();
            };
            const filterOptions = q => {
                const qq = (q || '').toLowerCase();
                Array.from(optsEl.children).forEach(child => {
                    const label = child.querySelector('span')?.textContent?.toLowerCase() || '';
                    child.style.display = label.includes(qq) ? '' : 'none';
                });
            };
            const openMenu = open => {
                root.classList.toggle('ms-open', !!open);
                control.setAttribute('aria-expanded', open ? 'true' : 'false');
                if (open) {
                    try {
                        if (menu) menu.scrollTop = 0;
                        if (optsEl) optsEl.scrollTop = 0;
                    } catch (e) {
                        dbg('ms scroll reset failed', e);
                    }
                }
            };
            // Handlers
            control.addEventListener('mousedown', e => {
                e.preventDefault();
                e.stopPropagation();
                const willOpen = !root.classList.contains('ms-open');
                openMenu(willOpen);
                if (willOpen) setTimeout(() => search.focus(), 0);
            });
            document.addEventListener('click', e => {
                if (!root.contains(e.target)) openMenu(false);
            });
            search.addEventListener('focus', () => openMenu(true));
            search.addEventListener('keydown', e => {
                if (e.key === 'Escape') openMenu(false);
            });
            search.addEventListener('input', () => filterOptions(search.value));
            selectAll.addEventListener('click', e => {
                e.preventDefault();
                const all = new Set(Array.from(sel.options).map(o => o.value));
                setSelected(all);
                syncOptions();
                renderChips();
            });
            clearAll.addEventListener('click', e => {
                e.preventDefault();
                setSelected(new Set());
                syncOptions();
                renderChips();
                search.value = '';
                filterOptions('');
            });
            clear?.addEventListener('click', e => {
                e.preventDefault();
                setSelected(new Set());
                syncOptions();
                renderChips();
                search.value = '';
                filterOptions('');
            });
            optsEl.addEventListener('click', e => {
                const row = e.target.closest('.ms-option');
                if (!row) return;
                const v = row.dataset.value;
                const selected = getSelected();
                if (selected.has(v)) selected.delete(v);
                else selected.add(v);
                setSelected(selected);
                syncOptions();
                renderChips();
            });
            // Initial paint
            buildOptions();
            renderChips();
            root.dataset.msWired = 'true';
        }

        // Refresh an already-initialized multiselect's options and chips from the current <select> state
        function rebuildMsForSelect(idBase, selectId) {
            const sel = document.getElementById(selectId);
            const root = document.getElementById(`${idBase}`);
            if (!sel || !root) return;
            if (root.dataset.msWired !== 'true') {
                // Not wired yet; initialize now
                initMsForSelect(idBase, selectId);
                return;
            }
            const control = root.querySelector('.ms-control');
            const chipsEl = root.querySelector('.ms-chips');
            const optsEl = document.getElementById(`${idBase}-options`);
            if (!control || !chipsEl || !optsEl) return;
            // Build options from current <select>
            const selected = new Set(Array.from(sel.selectedOptions).map(o => o.value));
            optsEl.innerHTML = '';
            const items = Array.from(sel.options).map(o => ({
                value: o.value,
                label: o.textContent,
            }));
            items.forEach(it => {
                const row = document.createElement('div');
                row.className = 'ms-option';
                row.dataset.value = it.value;
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.checked = selected.has(it.value);
                const span = document.createElement('span');
                span.textContent = it.label;
                row.appendChild(cb);
                row.appendChild(span);
                optsEl.appendChild(row);
            });
            // Render chips
            chipsEl.innerHTML = '';
            selected.forEach(v => {
                const label = Array.from(sel.options).find(o => o.value === v)?.textContent || v;
                const chip = document.createElement('span');
                chip.className = 'ms-chip';
                chip.dataset.value = v;
                chip.innerHTML = `${label} <i class="fas fa-xmark ms-chip-remove" title="Remove"></i>`;
                chip.querySelector('.ms-chip-remove')?.addEventListener('click', e => {
                    e.stopPropagation();
                    // Update select
                    Array.from(sel.options).forEach(o => {
                        if (o.value === v) o.selected = false;
                    });
                    // Recurse to refresh options and chips
                    rebuildMsForSelect(idBase, selectId);
                    control.classList.toggle('has-selection', sel.selectedOptions.length > 0);
                    sel.dispatchEvent(new Event('change', { bubbles: true }));
                });
                chipsEl.appendChild(chip);
            });
            control.classList.toggle('has-selection', selected.size > 0);
        }

        async function loadMediaSources(forceFresh = false) {
            const r = forceFresh
                ? await fetch('/api/admin/config', { credentials: 'include' })
                : await window.dedupJSON('/api/admin/config', { credentials: 'include' });
            const j = r.ok ? await r.json() : {};
            const env = j?.env || {};
            const cfg = j?.config || j || {};
            dbg('loadMediaSources()', { hasConfig: !!cfg, hasEnv: !!env });
            // Initialize once-per-session auto-fetch guards
            window.__autoFetchedLibs = window.__autoFetchedLibs || { plex: false, jf: false };
            // Plex/Jellyfin server entries
            const plex = (cfg.mediaServers || []).find(s => s.type === 'plex') || {};
            const jf = (cfg.mediaServers || []).find(s => s.type === 'jellyfin') || {};
            // Plex
            const plexEnabled = !!plex.enabled;
            const plexHostVar = plex.hostnameEnvVar || 'PLEX_HOSTNAME';
            const plexPortVar = plex.portEnvVar || 'PLEX_PORT';
            const plexTokenVar = plex.tokenEnvVar || 'PLEX_TOKEN';
            getInput('plex.enabled') && (getInput('plex.enabled').checked = plexEnabled);
            // Prefill status pill based on enabled + presence of host/port
            try {
                const pill = document.getElementById('plex-status-pill-header');
                const openLink = document.getElementById('plex-open-link');
                const host = env[plexHostVar] || '';
                const portVal = env[plexPortVar] || '';
                if (pill) {
                    pill.classList.remove(
                        'status-success',
                        'status-error',
                        'is-configured',
                        'is-not-configured'
                    );
                    if (!plexEnabled) {
                        pill.textContent = 'Disabled';
                        pill.classList.add('is-not-configured');
                    } else if (host && portVal) {
                        pill.textContent = 'Configured';
                        pill.classList.add('is-configured');
                    } else {
                        pill.textContent = 'Not configured';
                        pill.classList.add('is-not-configured');
                    }
                }
                if (openLink) {
                    if (plexEnabled && host && portVal) {
                        const portNum = Number(portVal);
                        const hostClean = host.replace(/^https?:\/\//i, '').replace(/\/?$/, '');
                        const protocol =
                            portNum === 443
                                ? 'https'
                                : /^https:\/\//i.test(host)
                                  ? 'https'
                                  : /^http:\/\//i.test(host)
                                    ? 'http'
                                    : 'http';
                        const base = `${protocol}://${hostClean}`;
                        const url = `${base}:${portVal}/web`;
                        openLink.href = url;
                        openLink.removeAttribute('hidden');
                    } else {
                        openLink.setAttribute('hidden', '');
                        openLink.removeAttribute('href');
                    }
                }
            } catch (_) {
                /* no-op */
            }
            if (getInput('plex.hostname')) getInput('plex.hostname').value = env[plexHostVar] || '';
            if (getInput('plex.port')) getInput('plex.port').value = env[plexPortVar] || '';
            if (getInput('plex.token')) {
                getInput('plex.token').value = '';
                getInput('plex.token').setAttribute(
                    'placeholder',
                    env[plexTokenVar] ? '••••••••' : 'X-Plex-Token'
                );
            }
            if (getInput('plex.recentOnly'))
                getInput('plex.recentOnly').checked = !!plex.recentlyAddedOnly;
            if (getInput('plex.recentDays'))
                getInput('plex.recentDays').value = plex.recentlyAddedDays ?? 30;
            // Sync enabled/disabled state of days input with checkbox
            try {
                const cb = getInput('plex.recentOnly');
                const days = getInput('plex.recentDays');
                if (days) days.disabled = !(cb && cb.checked);
            } catch (_) {}
            // Plex ratings/qualities multiselects (theme-demo)
            try {
                const ratingsCsv = Array.isArray(plex.ratingFilter)
                    ? plex.ratingFilter.join(',')
                    : plex.ratingFilter || '';
                await loadPlexRatings(ratingsCsv);
            } catch (e) {
                dbg('loadPlexRatings failed', e);
            }
            try {
                await loadPlexQualities(plex.qualityFilter || '');
            } catch (e) {
                dbg('loadPlexQualities failed', e);
            }
            if (getInput('plex.yearFilter')) {
                const v = plex.yearFilter;
                getInput('plex.yearFilter').value = v == null ? '' : String(v);
            }
            setMultiSelect(
                'plex.movies',
                (plex.movieLibraryNames || []).map(n => ({ value: n, label: n })),
                plex.movieLibraryNames || []
            );
            setMultiSelect(
                'plex.shows',
                (plex.showLibraryNames || []).map(n => ({ value: n, label: n })),
                plex.showLibraryNames || []
            );
            // Initialize theme-demo multiselects for Plex libraries
            initMsForSelect('plex-ms-movies', 'plex.movies');
            initMsForSelect('plex-ms-shows', 'plex.shows');
            // Populate Plex genres with counts and apply selected values from config
            await loadPlexGenres(plex.genreFilter || '');
            // Defer fetching Plex libraries until the Plex panel is opened
            // Jellyfin
            const jfEnabled = !!jf.enabled;
            const jfHostVar = jf.hostnameEnvVar || 'JELLYFIN_HOSTNAME';
            const jfPortVar = jf.portEnvVar || 'JELLYFIN_PORT';
            const jfKeyVar = jf.tokenEnvVar || 'JELLYFIN_API_KEY';
            if (getInput('jf.enabled')) getInput('jf.enabled').checked = jfEnabled;
            // Header pill for Jellyfin
            try {
                const pill = document.getElementById('jf-status-pill-header');
                const openLink = document.getElementById('jf-open-link');
                const host = env[jfHostVar] || '';
                const portVal = env[jfPortVar] || '';
                if (pill) {
                    pill.classList.remove(
                        'status-success',
                        'status-error',
                        'is-configured',
                        'is-not-configured'
                    );
                    if (!jfEnabled) {
                        pill.textContent = 'Disabled';
                        pill.classList.add('is-not-configured');
                    } else if (host && portVal) {
                        pill.textContent = 'Configured';
                        pill.classList.add('is-configured');
                    } else {
                        pill.textContent = 'Not configured';
                        pill.classList.add('is-not-configured');
                    }
                }
                if (openLink) {
                    if (jfEnabled && host && portVal) {
                        const portNum = Number(portVal);
                        const hostClean = host.replace(/^https?:\/\//i, '').replace(/\/?$/, '');
                        const protocol =
                            portNum === 443
                                ? 'https'
                                : /^https:\/\//i.test(host)
                                  ? 'https'
                                  : /^http:\/\//i.test(host)
                                    ? 'http'
                                    : 'http';
                        const base = `${protocol}://${hostClean}`;
                        const url = `${base}:${portVal}/web`;
                        openLink.href = url;
                        openLink.removeAttribute('hidden');
                    } else {
                        openLink.setAttribute('hidden', '');
                        openLink.removeAttribute('href');
                    }
                }
            } catch (_) {
                /* no-op */
            }
            if (getInput('jf.hostname')) getInput('jf.hostname').value = env[jfHostVar] || '';
            if (getInput('jf.port')) getInput('jf.port').value = env[jfPortVar] || '';
            if (getInput('jf.apikey')) {
                getInput('jf.apikey').value = '';
                getInput('jf.apikey').setAttribute(
                    'placeholder',
                    env[jfKeyVar] ? '••••••••' : 'Jellyfin API Key'
                );
            }
            if (getInput('jf.recentOnly'))
                getInput('jf.recentOnly').checked = !!jf.recentlyAddedOnly;
            if (getInput('jf.recentDays'))
                getInput('jf.recentDays').value = jf.recentlyAddedDays ?? 30;
            // Sync enabled/disabled state of days input with checkbox
            try {
                const cb = getInput('jf.recentOnly');
                const days = getInput('jf.recentDays');
                if (days) days.disabled = !(cb && cb.checked);
            } catch (_) {}
            if (getInput('jf.yearFilter')) {
                const v = jf.yearFilter;
                getInput('jf.yearFilter').value = v == null ? '' : String(v);
            }
            // Preload Jellyfin rating/genre/quality selectors using config values
            // Initialize library selects before fetching dependent data (genres need libraries)
            setMultiSelect(
                'jf.movies',
                (jf.movieLibraryNames || []).map(n => ({ value: n, label: n })),
                jf.movieLibraryNames || []
            );
            setMultiSelect(
                'jf.shows',
                (jf.showLibraryNames || []).map(n => ({ value: n, label: n })),
                jf.showLibraryNames || []
            );
            // Initialize theme-demo multiselects for Jellyfin libraries
            initMsForSelect('jf-ms-movies', 'jf.movies');
            initMsForSelect('jf-ms-shows', 'jf.shows');
            // Now load dependent selectors
            try {
                await loadJellyfinRatings(
                    Array.isArray(jf.ratingFilter)
                        ? jf.ratingFilter.join(',')
                        : jf.ratingFilter || ''
                );
            } catch (e) {
                dbg('loadJellyfinRatings failed', e);
            }
            try {
                await loadJellyfinGenres(jf.genreFilter || '');
            } catch (e) {
                dbg('loadJellyfinGenres failed', e);
            }
            try {
                // Jellyfin qualities disabled
                await loadJellyfinQualities('');
            } catch (e) {
                dbg('loadJellyfinQualities failed', e);
            }
            // Defer fetching Jellyfin libraries until the Jellyfin panel is opened
            // TMDB
            const tmdb = cfg.tmdbSource || {};
            if (getInput('tmdb.enabled')) getInput('tmdb.enabled').checked = !!tmdb.enabled;
            // Header pill for TMDB
            try {
                const pill = document.getElementById('tmdb-status-pill-header');
                if (pill) {
                    pill.classList.remove(
                        'status-success',
                        'status-error',
                        'is-configured',
                        'is-not-configured'
                    );
                    if (!tmdb.enabled) {
                        pill.textContent = 'Disabled';
                        pill.classList.add('is-not-configured');
                    } else if (tmdb.apiKey) {
                        pill.textContent = 'Configured';
                        pill.classList.add('is-configured');
                    } else {
                        pill.textContent = 'Not configured';
                        pill.classList.add('is-not-configured');
                    }
                }
            } catch (_) {
                /* no-op */
            }
            if (getInput('tmdb.apikey'))
                getInput('tmdb.apikey').value = tmdb.apiKey ? '••••••••' : '';
            if (getInput('tmdb.category')) {
                const el = getInput('tmdb.category');
                el.value = tmdb.category || 'popular';
                // Sync custom select UI/icon
                try {
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                } catch (_) {
                    // ignore (custom select sync)
                }
                syncCustomSelect(el);
            }
            if (getInput('tmdb.minRating')) {
                const v = Number(tmdb.minRating);
                getInput('tmdb.minRating').value = Number.isFinite(v) && v > 0 ? v : '';
            }
            if (getInput('tmdb.yearFilter')) {
                const v = tmdb.yearFilter;
                getInput('tmdb.yearFilter').value = v == null ? '' : String(v);
            }
            // Defer loading TMDB genres until the TMDB panel is opened
            // Streaming Releases (TMDB-based)
            try {
                const streaming = cfg.streamingSources || {};
                const setBool = (id, v) => {
                    const el = getInput(id);
                    if (el) el.checked = !!v;
                };
                const setVal = (id, v) => {
                    const el = getInput(id);
                    if (el) el.value = v ?? '';
                };
                setBool('streamingSources.enabled', streaming.enabled);
                setVal('streamingSources.region', streaming.region || 'US');
                if (getInput('streamingSources.minRating')) {
                    const v = Number(streaming.minRating);
                    getInput('streamingSources.minRating').value = Number.isFinite(v) ? v : '';
                }
                // Build provider multiselect options
                const providerOpts = [
                    { value: 'netflix', label: 'Netflix' },
                    { value: 'disney', label: 'Disney+' },
                    { value: 'prime', label: 'Prime Video' },
                    { value: 'hbo', label: 'Max (HBO)' },
                    { value: 'hulu', label: 'Hulu' },
                    { value: 'apple', label: 'Apple TV+' },
                    { value: 'paramount', label: 'Paramount+' },
                    { value: 'crunchyroll', label: 'Crunchyroll' },
                ];
                setMultiSelect(
                    'streaming.providers',
                    providerOpts,
                    Object.entries(streaming)
                        .filter(([k, v]) => v && providerOpts.some(p => p.value === k))
                        .map(([k]) => k)
                );
                initMsForSelect('streaming-ms-providers', 'streaming.providers');
                // New Releases toggle remains a standalone flag
                setBool('streamingSources.newReleases', streaming.newReleases);
            } catch (_) {
                // ignore (streaming UI init optional)
            }
            // TVDB
            const tvdb = cfg.tvdbSource || {};
            if (getInput('tvdb.enabled')) getInput('tvdb.enabled').checked = !!tvdb.enabled;
            // Header pill for TVDB
            try {
                const pill = document.getElementById('tvdb-status-pill-header');
                if (pill) {
                    pill.classList.remove(
                        'status-success',
                        'status-error',
                        'is-configured',
                        'is-not-configured'
                    );
                    if (!tvdb.enabled) {
                        pill.textContent = 'Disabled';
                        pill.classList.add('is-not-configured');
                    } else {
                        // No API key required for TVDB in our model; treat enabled as configured
                        pill.textContent = 'Configured';
                        pill.classList.add('is-configured');
                    }
                }
            } catch (_) {
                /* no-op */
            }
            const tvdbCatEl = getInput('tvdb.category');
            if (tvdbCatEl) {
                tvdbCatEl.value = tvdb.category || 'popular';
                // Sync custom select UI/icon
                try {
                    tvdbCatEl.dispatchEvent(new Event('change', { bubbles: true }));
                } catch (_) {
                    // ignore (custom select sync)
                }
                syncCustomSelect(tvdbCatEl);
            }
            const tvdbMinRatingEl = getInput('tvdb.minRating');
            if (tvdbMinRatingEl) {
                const v = Number(tvdb.minRating);
                tvdbMinRatingEl.value = Number.isFinite(v) && v > 0 ? v : '';
            }
            if (getInput('tvdb.yearFilter'))
                getInput('tvdb.yearFilter').value =
                    tvdb.yearFilter == null ? '' : String(tvdb.yearFilter);

            // Finally, paint overview cards (status + toggles + meta)
            updateOverviewCards(cfg, env);
            // Then fetch and paint last sync times
            refreshOverviewLastSync();
            // And compute current playlist counts per source
            refreshOverviewCounts();
            // Wire live listeners once per page load
            wireLiveMediaSourcePreview();
            // Enforce explicit click to edit sensitive fields and suppress auto-focus
            guardSensitiveInputs();
        }
        // Expose for reuse
        window.admin2 = window.admin2 || {};
        window.admin2.loadMediaSources = loadMediaSources;

        // Lazy fetch helpers: fire-and-forget conditional loads on panel open
        function maybeFetchPlexOnOpen() {
            try {
                (async () => {
                    window.__autoFetchedLibs = window.__autoFetchedLibs || {
                        plex: false,
                        jf: false,
                    };

                    // Always fetch libraries when opening the panel to ensure we have the full list
                    // This fixes the issue where only pre-selected libraries show as options
                    if (!window.__autoFetchedLibs.plex) {
                        window.__autoFetchedLibs.plex = true;
                        const silentFirst = window.__plexToastShown === true;
                        await fetchPlexLibraries(true, silentFirst);
                    }
                })();
            } catch (_) {
                /* ignore */
            }
        }

        function maybeFetchJellyfinOnOpen() {
            try {
                (async () => {
                    window.__autoFetchedLibs = window.__autoFetchedLibs || {
                        plex: false,
                        jf: false,
                    };

                    // Always fetch libraries when opening the panel to ensure we have the full list
                    // This fixes the issue where only pre-selected libraries show as options
                    if (!window.__autoFetchedLibs.jf) {
                        window.__autoFetchedLibs.jf = true;
                        await fetchJellyfinLibraries(true);
                    }
                })();
            } catch (_) {
                /* ignore */
            }
        }

        function maybeFetchTmdbOnOpen() {
            try {
                (async () => {
                    // Only load the TMDB genres once on first open
                    window.__autoFetchedLibs = window.__autoFetchedLibs || {
                        plex: false,
                        jf: false,
                    };
                    if (!window.__autoFetchedLibs.tmdb) {
                        window.__autoFetchedLibs.tmdb = true;
                        try {
                            // Use stored selection if any
                            const cfgRes = await window.dedupJSON('/api/admin/config', {
                                credentials: 'include',
                            });
                            const base = cfgRes?.config || cfgRes || {};
                            const tmdb = base.tmdbSource || {};
                            await loadTMDBGenres(tmdb.genreFilter || '');
                        } catch (_) {
                            // best-effort; keep UI responsive
                        }
                    }
                })();
            } catch (_) {
                /* ignore */
            }
        }

        // attach helpers to admin2 namespace
        window.admin2.maybeFetchPlexOnOpen = maybeFetchPlexOnOpen;
        window.admin2.maybeFetchJellyfinOnOpen = maybeFetchJellyfinOnOpen;
        window.admin2.maybeFetchTmdbOnOpen = maybeFetchTmdbOnOpen;

        // Fetch libraries
        async function fetchPlexLibraries(refreshFilters = false, silent = false) {
            // If any caller requests dependent refresh, mark it globally for this flight
            if (refreshFilters) window.__plexLibsRefreshRequested = true;
            // Deduplicate concurrent calls so only one request + toast occurs
            if (window.__plexLibsInFlight) return window.__plexLibsInFlight;
            window.__plexLibsInFlight = (async () => {
                try {
                    const hostname = getInput('plex.hostname')?.value || undefined;
                    const port = getInput('plex.port')?.value || undefined;
                    const token = getInput('plex.token')?.value || undefined;
                    const res = await fetch('/api/admin/plex-libraries', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ hostname, port, token }),
                    });
                    const j = await res.json().catch(() => ({}));
                    if (!res.ok) throw new Error(j?.error || 'Failed to load Plex libraries');
                    const libs = Array.isArray(j.libraries) ? j.libraries : [];
                    const movies = libs
                        .filter(l => l.type === 'movie')
                        .map(l => ({ value: l.name, label: l.name, count: l.itemCount }));
                    const shows = libs
                        .filter(l => l.type === 'show')
                        .map(l => ({ value: l.name, label: l.name, count: l.itemCount }));
                    const prevMovies = new Set(getMultiSelectValues('plex.movies'));
                    const prevShows = new Set(getMultiSelectValues('plex.shows'));
                    setMultiSelect('plex.movies', movies, Array.from(prevMovies));
                    setMultiSelect('plex.shows', shows, Array.from(prevShows));
                    // Rebuild multiselect options
                    rebuildMsForSelect('plex-ms-movies', 'plex.movies');
                    rebuildMsForSelect('plex-ms-shows', 'plex.shows');
                    if (!silent) {
                        window.notify?.toast({
                            type: 'success',
                            title: 'Plex',
                            message: 'Plex libraries loaded',
                            duration: 2200,
                        });
                        window.__plexToastShown = true;
                    }
                    // Immediately refresh counts to update the header pill
                    try {
                        refreshOverviewCounts();
                    } catch (_) {}
                    // Optionally refresh dependent filters now that libraries are known
                    if (window.__plexLibsRefreshRequested) {
                        try {
                            const currentGenres = getPlexGenreFilterHidden?.() || '';
                            loadPlexGenres(currentGenres)?.catch?.(() => {});
                            loadPlexRatings?.(getPlexHidden?.('plex.ratingFilter-hidden'));
                            loadPlexQualities?.(getPlexHidden?.('plex.qualityFilter-hidden'));
                        } catch (_) {
                            /* no-op */
                        }
                    }
                } catch (e) {
                    window.notify?.toast({
                        type: 'error',
                        title: 'Plex',
                        message: e?.message || 'Failed to fetch libraries',
                        duration: 4200,
                    });
                } finally {
                    // Clear in-flight marker after settle so subsequent manual fetches are allowed
                    window.__plexLibsInFlight = null;
                    // Reset refresh request flag after one settled cycle
                    window.__plexLibsRefreshRequested = false;
                }
            })();
            return window.__plexLibsInFlight;
        }

        // ------- Plex Genre Filter (chips with hidden input) -------
        function setPlexGenreFilterHidden(val) {
            const hidden = document.getElementById('plex.genreFilter-hidden');
            if (hidden) {
                hidden.value = val || '';
                // Ensure live counts update: trigger change so wireLiveMediaSourcePreview refreshes pills
                try {
                    hidden.dispatchEvent(new Event('change', { bubbles: true }));
                } catch (_) {}
            }
        }
        function getPlexGenreFilterHidden() {
            const hidden = document.getElementById('plex.genreFilter-hidden');
            return hidden ? hidden.value : '';
        }
        function renderChip(container, label, value, selectedValuesSet) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'chip';
            chip.setAttribute('data-value', value);
            chip.setAttribute('aria-pressed', selectedValuesSet.has(value) ? 'true' : 'false');
            const left = document.createElement('div');
            left.className = 'left';
            const icon = document.createElement('i');
            icon.className = selectedValuesSet.has(value) ? 'fas fa-check-circle' : 'far fa-circle';
            const span = document.createElement('span');
            span.className = 'title';
            span.textContent = label;
            left.appendChild(icon);
            left.appendChild(span);
            chip.appendChild(left);
            chip.addEventListener('click', () => {
                const current = new Set(
                    getPlexGenreFilterHidden()
                        .split(',')
                        .map(s => s.trim())
                        .filter(Boolean)
                );
                if (current.has(value)) current.delete(value);
                else current.add(value);
                const newVal = Array.from(current).join(',');
                setPlexGenreFilterHidden(newVal);
                // toggle visual
                const pressed = chip.getAttribute('aria-pressed') === 'true';
                chip.setAttribute('aria-pressed', pressed ? 'false' : 'true');
                icon.className = pressed ? 'far fa-circle' : 'fas fa-check-circle';
            });
            container.appendChild(chip);
        }
        // eslint-disable-next-line no-unused-vars
        function populatePlexGenreChips(genres, selectedCsv) {
            const container = document.getElementById('plex.genreFilter');
            const select = document.getElementById('plex.genreFilter-select');
            if (!container) return;
            const selected = new Set(
                String(selectedCsv || '')
                    .split(',')
                    .map(s => s.trim())
                    .filter(Boolean)
            );
            container.innerHTML = '';
            if (select) {
                // Build dropdown with an "Add genre…" placeholder
                const placeholder = document.createElement('option');
                placeholder.value = '';
                placeholder.textContent = 'Add genre…';
                select.innerHTML = '';
                select.appendChild(placeholder);
            }
            // Sort by count desc then name (normalize objects -> string names)
            const normName = g =>
                typeof g === 'string'
                    ? g
                    : (g && (g.genre || g.name || g.value || g.label || g.Title)) || String(g);
            const list = (genres || []).slice().sort((a, b) => {
                const ac = Number((a && a.count) || 0);
                const bc = Number((b && b.count) || 0);
                if (bc !== ac) return bc - ac;
                return String(normName(a)).localeCompare(String(normName(b)));
            });
            list.forEach(g => {
                const name = normName(g);
                const label = g.count != null ? `${name} (${g.count})` : name;
                renderChip(container, label, name, selected);
                if (select) {
                    const opt = document.createElement('option');
                    opt.value = name;
                    opt.textContent = name;
                    select.appendChild(opt);
                }
            });
            if (select) {
                // When user picks a genre from dropdown, add to selection and re-render icon state
                select.onchange = () => {
                    const val = select.value;
                    if (!val) return;
                    const current = new Set(
                        getPlexGenreFilterHidden()
                            .split(',')
                            .map(s => s.trim())
                            .filter(Boolean)
                    );
                    current.add(val);
                    const newVal = Array.from(current).join(',');
                    setPlexGenreFilterHidden(newVal);
                    // Update chip pressed state if it exists
                    const chip = container.querySelector(`[data-value="${CSS.escape(val)}"]`);
                    if (chip) {
                        chip.setAttribute('aria-pressed', 'true');
                        const icon = chip.querySelector('i');
                        if (icon) icon.className = 'fas fa-check-circle';
                    }
                    // reset dropdown to placeholder
                    select.value = '';
                };
            }
        }
        // Expose for reuse
        window.populatePlexGenreChips = populatePlexGenreChips;
        async function loadPlexGenres(currentValueCsv = '') {
            const chipsRoot = document.getElementById('plex-ms-genres-chips');
            const optsEl = document.getElementById('plex-ms-genres-options');
            const root = document.getElementById('plex-ms-genres');
            const control = root?.querySelector('.ms-control');
            const search = document.getElementById('plex-ms-genres-search');
            const menu = document.getElementById('plex-ms-genres-menu');
            if (!chipsRoot || !optsEl || !root || !control || !search) return;
            chipsRoot.innerHTML = '<div class="subtle">Loading genres…</div>';
            try {
                // Prefer test endpoint if user provided connection params
                const hostname = getInput('plex.hostname')?.value;
                const port = getInput('plex.port')?.value;
                const token = getInput('plex.token')?.value;
                let res;
                if (hostname && port) {
                    res = await window.dedupJSON('/api/admin/plex-genres-with-counts-test', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ hostname, port, token: token || undefined }),
                    });
                } else {
                    res = await window.dedupJSON('/api/admin/plex-genres-with-counts', {
                        credentials: 'include',
                    });
                }
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json().catch(() => ({}));
                const genres = Array.isArray(data?.genres) ? data.genres : [];
                // Build options list using normalized names from server objects
                const normName = g =>
                    typeof g === 'string'
                        ? g
                        : (g && (g.genre || g.name || g.value || g.label || g.Title)) || String(g);
                const names = genres
                    .slice()
                    .map(normName)
                    .sort((a, b) => a.localeCompare(b));
                const selected = new Set(
                    String(currentValueCsv || '')
                        .split(',')
                        .map(s => s.trim())
                        .filter(Boolean)
                );
                // Options
                optsEl.innerHTML = '';
                names.forEach(n => {
                    const row = document.createElement('div');
                    row.className = 'ms-option';
                    row.dataset.value = n;
                    const cb = document.createElement('input');
                    cb.type = 'checkbox';
                    cb.checked = selected.has(n);
                    const span = document.createElement('span');
                    span.textContent = n;
                    row.appendChild(cb);
                    row.appendChild(span);
                    optsEl.appendChild(row);
                });
                // Chips render
                const renderChips = () => {
                    chipsRoot.innerHTML = '';
                    selected.forEach(v => {
                        const chip = document.createElement('span');
                        chip.className = 'ms-chip';
                        chip.dataset.value = v;
                        chip.innerHTML = `${v} <i class="fas fa-xmark ms-chip-remove" title="Remove"></i>`;
                        chip.querySelector('.ms-chip-remove')?.addEventListener('click', e => {
                            e.stopPropagation();
                            selected.delete(v);
                            setPlexGenreFilterHidden(Array.from(selected).join(','));
                            syncOptions();
                            renderChips();
                            control.classList.toggle('has-selection', selected.size > 0);
                        });
                        chipsRoot.appendChild(chip);
                    });
                    control.classList.toggle('has-selection', selected.size > 0);
                };
                const syncOptions = () => {
                    document.querySelectorAll('#plex-ms-genres-options .ms-option').forEach(row => {
                        const v = row.dataset.value;
                        const cb = row.querySelector('input[type="checkbox"]');
                        if (cb) cb.checked = selected.has(v);
                    });
                };
                // Portalize menu to body and position it near control to avoid clipping
                if (menu && menu.parentElement !== document.body) {
                    document.body.appendChild(menu);
                    menu.style.position = 'fixed';
                    menu.style.zIndex = '9999';
                    menu.style.display = 'none';
                    menu.style.maxHeight = '60vh';
                    menu.style.overflow = 'auto';
                    menu.style.minWidth = '240px';
                }
                let onReposition;
                const positionMenu = () => {
                    if (!control || !menu) return;
                    const rect = control.getBoundingClientRect();
                    const viewportH = window.innerHeight || document.documentElement.clientHeight;
                    const belowSpace = viewportH - rect.bottom;
                    const estHeight = Math.min(menu.scrollHeight || 320, viewportH * 0.6);
                    const openUp = belowSpace < estHeight && rect.top > estHeight;
                    const top = openUp ? Math.max(8, rect.top - estHeight) : rect.bottom + 4;
                    const left = rect.left;
                    const width = Math.max(rect.width, 240);
                    menu.style.top = `${Math.round(top)}px`;
                    menu.style.left = `${Math.round(left)}px`;
                    menu.style.width = `${Math.round(width)}px`;
                    menu.style.maxHeight = `${Math.round(estHeight)}px`;
                };
                const openMenu = open => {
                    root.classList.toggle('ms-open', !!open);
                    control.setAttribute('aria-expanded', open ? 'true' : 'false');
                    if (!menu) return;
                    if (open) {
                        menu.style.display = 'block';
                        try {
                            menu.scrollTop = 0;
                            if (optsEl) optsEl.scrollTop = 0;
                        } catch (e) {
                            dbg('ms scroll reset failed (plex genres)', e);
                        }
                        positionMenu();
                        onReposition = () => positionMenu();
                        window.addEventListener('resize', onReposition, { passive: true });
                        window.addEventListener('scroll', onReposition, { passive: true });
                    } else {
                        menu.style.display = 'none';
                        if (onReposition) {
                            window.removeEventListener('resize', onReposition);
                            window.removeEventListener('scroll', onReposition);
                            onReposition = null;
                        }
                    }
                };
                // Wire interactions if not already
                if (root && root.dataset.msWired !== 'true') {
                    control.addEventListener('mousedown', e => {
                        e.preventDefault();
                        e.stopPropagation();
                        const willOpen = !root.classList.contains('ms-open');
                        openMenu(willOpen);
                        if (willOpen) setTimeout(() => search.focus(), 0);
                    });
                    document.addEventListener('click', e => {
                        if (!root.contains(e.target) && !(menu && menu.contains(e.target)))
                            openMenu(false);
                    });
                    search.addEventListener('focus', () => openMenu(true));
                    search.addEventListener('keydown', e => {
                        if (e.key === 'Escape') openMenu(false);
                    });
                    search.addEventListener('input', () => {
                        const q = search.value.toLowerCase();
                        Array.from(optsEl.children).forEach(ch => {
                            const label =
                                ch.querySelector('span')?.textContent?.toLowerCase() || '';
                            ch.style.display = label.includes(q) ? '' : 'none';
                        });
                    });
                    document
                        .getElementById('plex-ms-genres-select-all')
                        ?.addEventListener('click', e => {
                            e.preventDefault();
                            names.forEach(n => selected.add(n));
                            setPlexGenreFilterHidden(Array.from(selected).join(','));
                            syncOptions();
                            renderChips();
                        });
                    document
                        .getElementById('plex-ms-genres-clear-all')
                        ?.addEventListener('click', e => {
                            e.preventDefault();
                            selected.clear();
                            setPlexGenreFilterHidden('');
                            syncOptions();
                            renderChips();
                            search.value = '';
                        });
                    document
                        .getElementById('plex-ms-genres-clear')
                        ?.addEventListener('click', e => {
                            e.preventDefault();
                            selected.clear();
                            setPlexGenreFilterHidden('');
                            syncOptions();
                            renderChips();
                            search.value = '';
                        });
                    optsEl.addEventListener('click', e => {
                        const row = e.target.closest('.ms-option');
                        if (!row) return;
                        const v = row.dataset.value;
                        if (selected.has(v)) selected.delete(v);
                        else selected.add(v);
                        setPlexGenreFilterHidden(Array.from(selected).join(','));
                        syncOptions();
                        renderChips();
                    });
                    root.dataset.msWired = 'true';
                }
                // Initial paint and sync
                setPlexGenreFilterHidden(Array.from(selected).join(','));
                renderChips();
            } catch (e) {
                chipsRoot.innerHTML = '<div class="subtle">Failed to load genres</div>';
            }
        }
        async function fetchJellyfinLibraries(refreshFilters = false) {
            // If any caller requests dependent refresh, mark it globally for this flight
            if (refreshFilters) window.__jfLibsRefreshRequested = true;
            // Deduplicate concurrent calls so only one request + toast occurs
            if (window.__jfLibsInFlight) return window.__jfLibsInFlight;
            window.__jfLibsInFlight = (async () => {
                try {
                    const hostname = getInput('jf.hostname')?.value || undefined;
                    const port = getInput('jf.port')?.value || undefined;
                    const apiKey = getInput('jf.apikey')?.value || undefined;
                    const res = await fetch('/api/admin/jellyfin-libraries', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ hostname, port, apiKey }),
                    });
                    const j = await res.json().catch(() => ({}));
                    if (!res.ok) throw new Error(j?.error || 'Failed to load Jellyfin libraries');
                    const libs = Array.isArray(j.libraries) ? j.libraries : [];
                    const movies = libs
                        .filter(l => l.type === 'movie')
                        .map(l => ({ value: l.name, label: l.name, count: l.itemCount }));
                    const shows = libs
                        .filter(l => l.type === 'show')
                        .map(l => ({ value: l.name, label: l.name, count: l.itemCount }));
                    const prevMovies = new Set(getMultiSelectValues('jf.movies'));
                    const prevShows = new Set(getMultiSelectValues('jf.shows'));
                    setMultiSelect('jf.movies', movies, Array.from(prevMovies));
                    setMultiSelect('jf.shows', shows, Array.from(prevShows));
                    // Rebuild multiselect options
                    rebuildMsForSelect('jf-ms-movies', 'jf.movies');
                    rebuildMsForSelect('jf-ms-shows', 'jf.shows');
                    window.notify?.toast({
                        type: 'success',
                        title: 'Jellyfin',
                        message: 'Jellyfin libraries loaded',
                        duration: 2200,
                    });
                    // Optionally refresh dependent filters now that libraries are known
                    if (window.__jfLibsRefreshRequested) {
                        try {
                            loadJellyfinRatings?.(getJfHidden?.('jf.ratingFilter-hidden'));
                            loadJellyfinGenres?.(getJfHidden?.('jf.genreFilter-hidden'));
                            // Jellyfin qualities disabled
                            loadJellyfinQualities?.('');
                        } catch (_) {
                            /* no-op */
                        }
                    }
                } catch (e) {
                    window.notify?.toast({
                        type: 'error',
                        title: 'Jellyfin',
                        message: e?.message || 'Failed to fetch libraries',
                        duration: 4200,
                    });
                } finally {
                    // Clear in-flight marker after settle so subsequent manual fetches are allowed
                    window.__jfLibsInFlight = null;
                    // Reset refresh request flag after one settled cycle
                    window.__jfLibsRefreshRequested = false;
                }
            })();
            return window.__jfLibsInFlight;
        }

        // ------- Jellyfin Multiselect Helpers (ratings/genres/qualities) -------
        function setJfHidden(id, val) {
            const el = document.getElementById(id);
            if (el) {
                el.value = val || '';
                try {
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                } catch (_) {}
            }
        }
        function getJfHidden(id) {
            const el = document.getElementById(id);
            return el ? el.value : '';
        }
        function jfMsOption(name, checked) {
            const row = document.createElement('div');
            row.className = 'ms-option';
            row.setAttribute('role', 'option');
            row.dataset.value = name;
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = !!checked;
            const label = document.createElement('span');
            label.textContent = name;
            row.appendChild(cb);
            row.appendChild(label);
            return row;
        }
        function jfAttachMsHandlers(baseId, options, selected, onUpdate) {
            const root = document.getElementById(baseId);
            if (!root || root.dataset.msWired === 'true') return;
            const control = root.querySelector('.ms-control');
            const menu = document.getElementById(baseId + '-menu');
            const search = document.getElementById(baseId + '-search');
            const selectAll = document.getElementById(baseId + '-select-all');
            const clearAll = document.getElementById(baseId + '-clear-all');
            const clearBtn = document.getElementById(baseId + '-clear');
            const optsEl = document.getElementById(baseId + '-options');
            const chips = document.getElementById(baseId + '-chips');
            if (!control || !menu || !search || !selectAll || !clearAll || !optsEl || !chips)
                return;

            const renderChips = () => {
                chips.innerHTML = '';
                Array.from(selected).forEach(v => {
                    const chip = document.createElement('span');
                    chip.className = 'ms-chip';
                    chip.dataset.value = v;
                    chip.innerHTML = `${v} <i class="fas fa-xmark ms-chip-remove" title="Remove"></i>`;
                    chip.querySelector('.ms-chip-remove')?.addEventListener('click', e => {
                        e.stopPropagation();
                        selected.delete(v);
                        onUpdate(selected);
                        syncOptions();
                        renderChips();
                        control.classList.toggle('has-selection', selected.size > 0);
                    });
                    chips.appendChild(chip);
                });
                control.classList.toggle('has-selection', selected.size > 0);
            };
            const syncOptions = () => {
                Array.from(optsEl.children).forEach(row => {
                    const v = row.dataset.value;
                    const cb = row.querySelector('input[type="checkbox"]');
                    if (cb) cb.checked = selected.has(v);
                });
            };
            // Move menu into body to avoid clipping and position it near control
            if (menu && menu.parentElement !== document.body) {
                document.body.appendChild(menu);
                menu.style.position = 'fixed';
                menu.style.zIndex = '9999';
                menu.style.display = 'none';
                menu.style.maxHeight = '60vh';
                menu.style.overflow = 'auto';
                menu.style.minWidth = '240px';
            }
            let onReposition;
            const positionMenu = () => {
                if (!control || !menu) return;
                const rect = control.getBoundingClientRect();
                const viewportH = window.innerHeight || document.documentElement.clientHeight;
                const belowSpace = viewportH - rect.bottom;
                const estHeight = Math.min(menu.scrollHeight || 320, viewportH * 0.6);
                const openUp = belowSpace < estHeight && rect.top > estHeight;
                const top = openUp ? Math.max(8, rect.top - estHeight) : rect.bottom + 4;
                const left = rect.left;
                const width = Math.max(rect.width, 240);
                menu.style.top = `${Math.round(top)}px`;
                menu.style.left = `${Math.round(left)}px`;
                menu.style.width = `${Math.round(width)}px`;
                menu.style.maxHeight = `${Math.round(estHeight)}px`;
            };
            const openMenu = open => {
                root.classList.toggle('ms-open', !!open);
                control.setAttribute('aria-expanded', open ? 'true' : 'false');
                if (!menu) return;
                if (open) {
                    menu.style.display = 'block';
                    try {
                        menu.scrollTop = 0;
                        if (optsEl) optsEl.scrollTop = 0;
                    } catch (e) {
                        dbg('ms scroll reset failed (jf)', e);
                    }
                    positionMenu();
                    onReposition = () => positionMenu();
                    window.addEventListener('resize', onReposition, { passive: true });
                    window.addEventListener('scroll', onReposition, { passive: true });
                } else {
                    menu.style.display = 'none';
                    if (onReposition) {
                        window.removeEventListener('resize', onReposition);
                        window.removeEventListener('scroll', onReposition);
                        onReposition = null;
                    }
                }
            };
            const filterOptions = q => {
                const qq = (q || '').toLowerCase();
                Array.from(optsEl.children).forEach(child => {
                    const match = child.dataset.value?.toLowerCase().includes(qq);
                    child.style.display = match ? '' : 'none';
                });
            };

            control.addEventListener('mousedown', e => {
                e.preventDefault();
                e.stopPropagation();
                const willOpen = !root.classList.contains('ms-open');
                openMenu(willOpen);
                if (willOpen) setTimeout(() => search.focus(), 0);
            });
            document.addEventListener('click', e => {
                if (!root.contains(e.target) && !(menu && menu.contains(e.target))) openMenu(false);
            });
            search.addEventListener('focus', () => openMenu(true));
            search.addEventListener('keydown', e => {
                if (e.key === 'Escape') openMenu(false);
            });
            search.addEventListener('input', () => filterOptions(search.value));
            selectAll.addEventListener('click', e => {
                e.preventDefault();
                options.forEach(n => selected.add(n));
                onUpdate(selected);
                syncOptions();
                renderChips();
            });
            clearAll.addEventListener('click', e => {
                e.preventDefault();
                selected.clear();
                onUpdate(selected);
                syncOptions();
                renderChips();
                search.value = '';
                filterOptions('');
            });
            clearBtn?.addEventListener('click', e => {
                e.preventDefault();
                selected.clear();
                onUpdate(selected);
                syncOptions();
                renderChips();
                search.value = '';
                filterOptions('');
            });
            optsEl.addEventListener('click', e => {
                const row = e.target.closest('.ms-option');
                if (!row) return;
                const v = row.dataset.value;
                if (selected.has(v)) selected.delete(v);
                else selected.add(v);
                onUpdate(selected);
                syncOptions();
                renderChips();
            });
            root.dataset.msWired = 'true';
            renderChips();
        }
        async function loadJellyfinRatings(currentCsv = '') {
            const chips = document.getElementById('jf-ms-ratings-chips');
            const optsEl = document.getElementById('jf-ms-ratings-options');
            const control = document.querySelector('#jf-ms-ratings .ms-control');
            const root = document.getElementById('jf-ms-ratings');
            if (!chips || !optsEl || !control) return;
            chips.innerHTML = '<div class="subtle">Loading ratings…</div>';
            try {
                const res = await window.dedupJSON('/api/sources/jellyfin/ratings-with-counts', {
                    credentials: 'include',
                });
                const data = await res.json().catch(() => ({}));
                const arr = Array.isArray(data?.data) ? data.data : [];
                const ratings = arr
                    .map(r => r.rating)
                    .filter(Boolean)
                    .sort();
                const selected = new Set(
                    String(currentCsv || '')
                        .split(',')
                        .map(s => s.trim())
                        .filter(Boolean)
                );
                optsEl.innerHTML = '';
                ratings.forEach(n => optsEl.appendChild(jfMsOption(n, selected.has(n))));
                setJfHidden('jf.ratingFilter-hidden', Array.from(selected).join(','));
                if (root?.dataset.msWired === 'true') {
                    const syncOptions = () => {
                        Array.from(optsEl.children).forEach(row => {
                            const v = row.dataset.value;
                            const cb = row.querySelector('input[type="checkbox"]');
                            if (cb) cb.checked = selected.has(v);
                        });
                    };
                    const renderChips = () => {
                        chips.innerHTML = '';
                        Array.from(selected).forEach(v => {
                            const chip = document.createElement('span');
                            chip.className = 'ms-chip';
                            chip.dataset.value = v;
                            chip.innerHTML = `${v} <i class="fas fa-xmark ms-chip-remove" title="Remove"></i>`;
                            chip.querySelector('.ms-chip-remove')?.addEventListener('click', e => {
                                e.stopPropagation();
                                selected.delete(v);
                                setJfHidden(
                                    'jf.ratingFilter-hidden',
                                    Array.from(selected).join(',')
                                );
                                syncOptions();
                                renderChips();
                                control.classList.toggle('has-selection', selected.size > 0);
                            });
                            chips.appendChild(chip);
                        });
                        control.classList.toggle('has-selection', selected.size > 0);
                    };
                    syncOptions();
                    renderChips();
                } else {
                    jfAttachMsHandlers('jf-ms-ratings', ratings, selected, sel =>
                        setJfHidden('jf.ratingFilter-hidden', Array.from(sel).join(','))
                    );
                }
            } catch (e) {
                chips.innerHTML = '<div class="subtle">Failed to load ratings</div>';
            }
        }
        // (No loadJellyfinQualities here — defined later)
        async function loadJellyfinGenres(currentCsv = '') {
            const chips = document.getElementById('jf-ms-genres-chips');
            const optsEl = document.getElementById('jf-ms-genres-options');
            const control = document.querySelector('#jf-ms-genres .ms-control');
            const root = document.getElementById('jf-ms-genres');
            if (!chips || !optsEl || !control) return;
            chips.innerHTML = '<div class="subtle">Loading genres…</div>';
            try {
                const hostname = getInput('jf.hostname')?.value;
                const port = getInput('jf.port')?.value;
                const apiKey = getInput('jf.apikey')?.value;
                const movieLibraries = getMultiSelectValues('jf.movies');
                const showLibraries = getMultiSelectValues('jf.shows');
                // If no libraries are selected yet, don't call the API (it requires at least one)
                if (movieLibraries.length === 0 && showLibraries.length === 0) {
                    chips.innerHTML =
                        '<div class="subtle">Select one or more libraries to load genres</div>';
                    optsEl.innerHTML = '';
                    setJfHidden('jf.genreFilter-hidden', '');
                    return;
                }
                const res = await window.dedupJSON('/api/admin/jellyfin-genres-with-counts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        hostname,
                        port,
                        apiKey: apiKey || undefined,
                        movieLibraries,
                        showLibraries,
                    }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data?.error || 'Failed');
                const names = (data?.genres || [])
                    .map(g => g.genre || g.name || g.value || String(g))
                    .filter(Boolean)
                    .sort((a, b) => a.localeCompare(b));
                const selected = new Set(
                    String(currentCsv || '')
                        .split(',')
                        .map(s => s.trim())
                        .filter(Boolean)
                );
                optsEl.innerHTML = '';
                names.forEach(n => optsEl.appendChild(jfMsOption(n, selected.has(n))));
                setJfHidden('jf.genreFilter-hidden', Array.from(selected).join(','));
                if (root?.dataset.msWired === 'true') {
                    const syncOptions = () => {
                        Array.from(optsEl.children).forEach(row => {
                            const v = row.dataset.value;
                            const cb = row.querySelector('input[type="checkbox"]');
                            if (cb) cb.checked = selected.has(v);
                        });
                    };
                    const renderChips = () => {
                        chips.innerHTML = '';
                        Array.from(selected).forEach(v => {
                            const chip = document.createElement('span');
                            chip.className = 'ms-chip';
                            chip.dataset.value = v;
                            chip.innerHTML = `${v} <i class="fas fa-xmark ms-chip-remove" title="Remove"></i>`;
                            chip.querySelector('.ms-chip-remove')?.addEventListener('click', e => {
                                e.stopPropagation();
                                selected.delete(v);
                                setJfHidden(
                                    'jf.genreFilter-hidden',
                                    Array.from(selected).join(',')
                                );
                                syncOptions();
                                renderChips();
                                control.classList.toggle('has-selection', selected.size > 0);
                            });
                            chips.appendChild(chip);
                        });
                        control.classList.toggle('has-selection', selected.size > 0);
                    };
                    syncOptions();
                    renderChips();
                } else {
                    jfAttachMsHandlers('jf-ms-genres', names, selected, sel =>
                        setJfHidden('jf.genreFilter-hidden', Array.from(sel).join(','))
                    );
                }
            } catch (e) {
                chips.innerHTML = '<div class="subtle">Failed to load genres</div>';
            }
        }
        async function loadJellyfinQualities(_currentCsv = '') {
            // Disable Jellyfin quality filtering in UI; clear state and show notice
            const root = document.getElementById('jf-ms-qualities');
            const chips = document.getElementById('jf-ms-qualities-chips');
            const optsEl = document.getElementById('jf-ms-qualities-options');
            if (root) root.classList.add('disabled');
            if (chips)
                chips.innerHTML =
                    '<div class="subtle">Qualiteitsfilter is uitgeschakeld voor Jellyfin</div>';
            if (optsEl) optsEl.innerHTML = '';
            if (typeof setJfHidden === 'function') setJfHidden('jf.qualityFilter-hidden', '');
            return;
        }

        // Test connections
        // Small helper to show a spinner on icon-only buttons
        function startBtnSpinner(btn) {
            if (!btn) return;
            if (!btn.dataset.prevHtml) btn.dataset.prevHtml = btn.innerHTML;
            btn.disabled = true;
            btn.classList.add('btn-loading');
            btn.setAttribute('aria-busy', 'true');
            // Use a CSS spinner element (no <i> to avoid being hidden by loading styles)
            btn.innerHTML =
                '<span class="spinner" aria-hidden="true" style="display:inline-block"></span>' +
                (btn.dataset.prevHtml || '');
        }
        function stopBtnSpinner(btn) {
            if (!btn) return;
            btn.innerHTML = btn.dataset.prevHtml || btn.innerHTML;
            btn.classList.remove('btn-loading');
            btn.disabled = false;
            btn.removeAttribute('aria-busy');
        }

        function setPlexStatus(text, variant = '', _url = '') {
            const pill = document.getElementById('plex-status-pill-header');
            if (pill) {
                pill.textContent = text;
                pill.classList.remove('status-success', 'status-error');
                if (variant) pill.classList.add(variant);
            }
            // URL is not shown in the header pill to keep it compact
        }

        async function testPlex() {
            const btn = document.getElementById('btn-plex-test');
            startBtnSpinner(btn);
            try {
                const hostname = getInput('plex.hostname')?.value || '';
                const port = getInput('plex.port')?.value || '';
                const token = getInput('plex.token')?.value || '';
                if (!hostname || !port) throw new Error('Hostname and port are required');
                const res = await fetch('/api/admin/test-plex', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ hostname, port, token: token || undefined }),
                });
                const j = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(j?.error || 'Connection failed');
                window.notify?.toast({
                    type: 'success',
                    title: 'Plex',
                    message: 'Connection successful',
                    duration: 2200,
                });
                const portNum = Number(port);
                const hostClean = String(hostname)
                    .replace(/^https?:\/\//i, '')
                    .replace(/\/?$/, '');
                const protocol =
                    portNum === 443
                        ? 'https'
                        : /^https:\/\//i.test(hostname)
                          ? 'https'
                          : /^http:\/\//i.test(hostname)
                            ? 'http'
                            : 'http';
                const basePlex = `${protocol}://${hostClean}`;
                const url = `${basePlex}:${port}/web`;
                setPlexStatus('Connected', 'status-success', url);
                const linkPlex = document.getElementById('plex-open-link');
                if (linkPlex) {
                    linkPlex.href = url;
                    linkPlex.removeAttribute('hidden');
                }
                // On success, offer to fetch libraries
                fetchPlexLibraries(true, true);
                // And refresh available filters using the same connection context
                const currentGenres = getPlexGenreFilterHidden();
                loadPlexGenres(currentGenres).catch(() => {});
                loadPlexRatings(getPlexHidden('plex.ratingFilter-hidden'));
                loadPlexQualities(getPlexHidden('plex.qualityFilter-hidden'));
            } catch (e) {
                window.notify?.toast({
                    type: 'error',
                    title: 'Plex',
                    message: e?.message || 'Connection failed',
                    duration: 4200,
                });
                setPlexStatus('Connection failed', 'status-error', '');
            } finally {
                stopBtnSpinner(btn);
            }
        }
        async function testJellyfin() {
            const btn = document.getElementById('btn-jf-test');
            startBtnSpinner(btn);
            try {
                const hostname = getInput('jf.hostname')?.value || '';
                const port = getInput('jf.port')?.value || '';
                const apiKey = getInput('jf.apikey')?.value || '';
                const insecureHttps = !!(
                    document.getElementById('jf.insecureHttps')?.checked ||
                    document.getElementById('jf.insecureHttpsHeader')?.checked
                );
                if (!hostname || !port) throw new Error('Hostname and port are required');
                const res = await fetch('/api/admin/test-jellyfin', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        hostname,
                        port,
                        apiKey: apiKey || undefined,
                        insecureHttps,
                    }),
                });
                const j = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(j?.error || 'Connection failed');
                window.notify?.toast({
                    type: 'success',
                    title: 'Jellyfin',
                    message: 'Connection successful',
                    duration: 2200,
                });
                const pill = document.getElementById('jf-status-pill-header');
                if (pill) {
                    pill.textContent = 'Connected';
                    pill.classList.remove('status-error', 'is-not-configured');
                    pill.classList.add('status-success', 'is-configured');
                }
                const linkJf = document.getElementById('jf-open-link');
                if (linkJf && hostname && port) {
                    const portNum = Number(port);
                    const hostClean = String(hostname)
                        .replace(/^https?:\/\//i, '')
                        .replace(/\/?$/, '');
                    const protocol =
                        portNum === 443
                            ? 'https'
                            : /^https:\/\//i.test(hostname)
                              ? 'https'
                              : /^http:\/\//i.test(hostname)
                                ? 'http'
                                : 'http';
                    const base = `${protocol}://${hostClean}`;
                    linkJf.href = `${base}:${port}/web`;
                    linkJf.removeAttribute('hidden');
                }
                fetchJellyfinLibraries();
                // Refresh dependent filters
                loadJellyfinRatings(getJfHidden('jf.ratingFilter-hidden'));
                loadJellyfinGenres(getJfHidden('jf.genreFilter-hidden'));
                // Jellyfin qualities disabled
                loadJellyfinQualities('');
            } catch (e) {
                window.notify?.toast({
                    type: 'error',
                    title: 'Jellyfin',
                    message: e?.message || 'Connection failed',
                    duration: 4200,
                });
                const pill = document.getElementById('jf-status-pill-header');
                if (pill) {
                    pill.textContent = 'Connection failed';
                    pill.classList.remove('status-success', 'is-configured');
                    pill.classList.add('status-error', 'is-not-configured');
                }
            } finally {
                stopBtnSpinner(btn);
            }
        }
        async function testTMDB() {
            const btn = document.getElementById('btn-tmdb-test');
            startBtnSpinner(btn);
            try {
                let apiKey = getInput('tmdb.apikey')?.value || '';
                // If no key provided, try stored key on server
                if (!apiKey) apiKey = 'stored_key';
                const res = await fetch('/api/admin/test-tmdb', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ apiKey: apiKey || undefined }),
                });
                const j = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(j?.error || 'TMDB test failed');
                window.notify?.toast({
                    type: 'success',
                    title: 'TMDB',
                    message: 'Connection successful',
                    duration: 2200,
                });
                const pill = document.getElementById('tmdb-status-pill-header');
                if (pill) {
                    pill.textContent = 'Connected';
                    pill.classList.remove('status-error', 'is-not-configured');
                    pill.classList.add('status-success', 'is-configured');
                }
                // On success, reload genres in case API key unlocks genre list
                const curr = getTMDBGenreFilterHidden();
                loadTMDBGenres(curr).catch(() => {});
            } catch (e) {
                window.notify?.toast({
                    type: 'error',
                    title: 'TMDB',
                    message: e?.message || 'Connection failed',
                    duration: 4200,
                });
                const pill = document.getElementById('tmdb-status-pill-header');
                if (pill) {
                    pill.textContent = 'Connection failed';
                    pill.classList.remove('status-success', 'is-configured');
                    pill.classList.add('status-error', 'is-not-configured');
                }
            } finally {
                stopBtnSpinner(btn);
            }
        }
        // Test Streaming (TMDB providers)
        async function testStreaming() {
            const btn = document.getElementById('test-streaming-button');
            if (!btn) return;
            startBtnSpinner(btn);
            const status = document.getElementById('streaming-connection-status');
            try {
                const enabled = !!document.getElementById('streamingSources.enabled')?.checked;
                if (!enabled) {
                    window.notify?.toast({
                        type: 'warning',
                        title: 'Streaming',
                        message: 'Streaming sources are disabled',
                        duration: 3000,
                    });
                    return;
                }
                // No inline 'Testing…' status; use toasts only for disabled/failure/errors
                const region = document.getElementById('streamingSources.region')?.value || 'US';
                let apiKey = document.getElementById('tmdb.apikey')?.value?.trim() || '';
                if (!apiKey) apiKey = 'stored_key';
                const res = await fetch('/api/admin/test-tmdb', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ testType: 'streaming', region, apiKey }),
                });
                const j = await res.json().catch(() => ({}));
                if (res.ok && j?.success) {
                    if (status) {
                        status.textContent = `Streaming API ready (Region: ${region})`;
                        status.style.color = '#51cf66';
                    }
                    window.notify?.toast({
                        type: 'success',
                        title: 'Streaming',
                        message: `Connection successful (Region: ${region})`,
                        duration: 2400,
                    });
                } else {
                    const err = j?.error || `HTTP ${res.status}`;
                    window.notify?.toast({
                        type: 'error',
                        title: 'Streaming',
                        message: `Connection failed: ${err}`,
                        duration: 4200,
                    });
                }
            } catch (e) {
                window.notify?.toast({
                    type: 'error',
                    title: 'Streaming',
                    message: `Test error: ${e?.message || 'Unknown error'}`,
                    duration: 4200,
                });
            } finally {
                stopBtnSpinner(btn);
            }
        }
        async function testTVDB() {
            const btn = document.getElementById('btn-tvdb-test');
            startBtnSpinner(btn);
            try {
                const res = await fetch('/api/admin/test-tvdb', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                });
                const j = await res.json().catch(() => ({}));
                if (!res.ok || !j?.success) throw new Error(j?.error || 'TVDB test failed');
                window.notify?.toast({
                    type: 'success',
                    title: 'TVDB',
                    message: 'Connection successful',
                    duration: 2200,
                });
            } catch (e) {
                window.notify?.toast({
                    type: 'error',
                    title: 'TVDB',
                    message: e?.message || 'Connection failed',
                    duration: 4200,
                });
            } finally {
                stopBtnSpinner(btn);
            }
        }

        // (deduped) Only one testTVDB implementation remains (spinner-based)

        // Per-source save helpers
        async function savePlex() {
            const btn = document.getElementById('btn-save-plex');
            btn?.classList.add('btn-loading');
            try {
                const cfgRes = await window.dedupJSON('/api/admin/config', {
                    credentials: 'include',
                });
                const base = cfgRes.ok ? await cfgRes.json() : {};
                const currentCfg = base?.config || base || {};
                const servers = Array.isArray(currentCfg.mediaServers)
                    ? [...currentCfg.mediaServers]
                    : [];
                const plexIdx = servers.findIndex(s => s.type === 'plex');
                const plex = plexIdx >= 0 ? { ...servers[plexIdx] } : { type: 'plex' };
                // Update Plex fields
                plex.enabled = !!getInput('plex.enabled')?.checked;
                plex.recentlyAddedOnly = !!getInput('plex.recentOnly')?.checked;
                plex.recentlyAddedDays = toInt(getInput('plex.recentDays')?.value) ?? 30;
                // From multiselect hidden fields
                plex.ratingFilter = parseCsvList(getPlexHidden('plex.ratingFilter-hidden'));
                // Save Plex qualities as CSV (supports multiple)
                plex.qualityFilter = (getPlexHidden('plex.qualityFilter-hidden') || '').trim();
                {
                    const expr = parseYearExpression(getInput('plex.yearFilter')?.value);
                    plex.yearFilter = expr;
                }
                plex.genreFilter = getPlexGenreFilterHidden();
                plex.movieLibraryNames = getMultiSelectValues('plex.movies');
                plex.showLibraryNames = getMultiSelectValues('plex.shows');
                plex.hostnameEnvVar = plex.hostnameEnvVar || 'PLEX_HOSTNAME';
                plex.portEnvVar = plex.portEnvVar || 'PLEX_PORT';
                plex.tokenEnvVar = plex.tokenEnvVar || 'PLEX_TOKEN';
                if (plexIdx >= 0) servers[plexIdx] = plex;
                else servers.push(plex);
                // Env updates (only if provided)
                const envPatch = {};
                const setIfProvided = (key, val) => {
                    if (val != null && String(val).trim() !== '')
                        envPatch[key] = String(val).trim();
                };
                setIfProvided(plex.hostnameEnvVar, getInput('plex.hostname')?.value);
                setIfProvided(plex.portEnvVar, getInput('plex.port')?.value);
                const plexToken = getInput('plex.token')?.value;
                if (plexToken && plexToken !== '••••••••')
                    setIfProvided(plex.tokenEnvVar, plexToken);
                await saveConfigPatch({ mediaServers: servers }, envPatch);
                window.notify?.toast({
                    type: 'success',
                    title: 'Saved',
                    message: 'Plex settings updated',
                    duration: 2500,
                });
            } catch (e) {
                window.notify?.toast({
                    type: 'error',
                    title: 'Save failed',
                    message: e?.message || 'Unable to save Plex',
                    duration: 4500,
                });
            } finally {
                btn?.classList.remove('btn-loading');
                // allow one auto-fetch after save on next load
                if (window.__autoFetchedLibs) window.__autoFetchedLibs.plex = false;
                loadMediaSources(true)
                    .then(() => {
                        const r = getPlexGenreFilterHidden();
                        loadPlexGenres(r).catch(() => {});
                        loadPlexRatings(getPlexHidden('plex.ratingFilter-hidden'));
                        loadPlexQualities(getPlexHidden('plex.qualityFilter-hidden'));
                    })
                    .catch(() => {});
            }
        }

        async function saveJellyfin() {
            const btn = document.getElementById('btn-save-jellyfin');
            btn?.classList.add('btn-loading');
            try {
                const cfgRes = await window.dedupJSON('/api/admin/config', {
                    credentials: 'include',
                });
                const base = cfgRes.ok ? await cfgRes.json() : {};
                const currentCfg = base?.config || base || {};
                const servers = Array.isArray(currentCfg.mediaServers)
                    ? [...currentCfg.mediaServers]
                    : [];
                const jfIdx = servers.findIndex(s => s.type === 'jellyfin');
                const jf = jfIdx >= 0 ? { ...servers[jfIdx] } : { type: 'jellyfin' };
                jf.enabled = !!getInput('jf.enabled')?.checked;
                jf.recentlyAddedOnly = !!getInput('jf.recentOnly')?.checked;
                jf.recentlyAddedDays = toInt(getInput('jf.recentDays')?.value) ?? 30;
                {
                    const expr = parseYearExpression(getInput('jf.yearFilter')?.value);
                    jf.yearFilter = expr;
                }
                // Collect multiselect values
                const ratingCsv = getJfHidden('jf.ratingFilter-hidden');
                jf.ratingFilter = parseCsvList(ratingCsv);
                jf.genreFilter = getJfHidden('jf.genreFilter-hidden');
                // Jellyfin qualities disabled
                jf.qualityFilter = '';
                jf.movieLibraryNames = getMultiSelectValues('jf.movies');
                jf.showLibraryNames = getMultiSelectValues('jf.shows');
                jf.hostnameEnvVar = jf.hostnameEnvVar || 'JELLYFIN_HOSTNAME';
                jf.portEnvVar = jf.portEnvVar || 'JELLYFIN_PORT';
                jf.tokenEnvVar = jf.tokenEnvVar || 'JELLYFIN_API_KEY';
                if (jfIdx >= 0) servers[jfIdx] = jf;
                else servers.push(jf);
                const envPatch = {};
                const setIfProvided = (key, val) => {
                    if (val != null && String(val).trim() !== '')
                        envPatch[key] = String(val).trim();
                };
                setIfProvided(jf.hostnameEnvVar, getInput('jf.hostname')?.value);
                setIfProvided(jf.portEnvVar, getInput('jf.port')?.value);
                const jfKey = getInput('jf.apikey')?.value;
                if (jfKey && jfKey !== '••••••••') setIfProvided(jf.tokenEnvVar, jfKey);
                await saveConfigPatch({ mediaServers: servers }, envPatch);
                window.notify?.toast({
                    type: 'success',
                    title: 'Saved',
                    message: 'Jellyfin settings updated',
                    duration: 2500,
                });
            } catch (e) {
                window.notify?.toast({
                    type: 'error',
                    title: 'Save failed',
                    message: e?.message || 'Unable to save Jellyfin',
                    duration: 4500,
                });
            } finally {
                btn?.classList.remove('btn-loading');
                // allow one auto-fetch after save on next load
                if (window.__autoFetchedLibs) window.__autoFetchedLibs.jf = false;
                loadMediaSources(true).catch(() => {});
            }
        }

        async function saveTMDB() {
            const btn = document.getElementById('btn-save-tmdb');
            await saveConfigPatch({ tvdbSource: tvdb });
            // Refresh header pills and counts to reflect new TVDB enabled state
            try {
                await loadMediaSources(true);
            } catch (_) {
                /* non-fatal */
            }
            try {
                const cfgRes = await window.dedupJSON('/api/admin/config', {
                    credentials: 'include',
                });
                const base = cfgRes.ok ? await cfgRes.json() : {};
                const currentCfg = base?.config || base || {};
                const tmdb = { ...(currentCfg.tmdbSource || {}) };
                tmdb.enabled = !!getInput('tmdb.enabled')?.checked;
                tmdb.category = getInput('tmdb.category')?.value || 'popular';
                {
                    const mr = toInt(getInput('tmdb.minRating')?.value);
                    tmdb.minRating = Number.isFinite(mr) && mr > 0 ? mr : undefined;
                }
                {
                    const expr = parseYearExpression(getInput('tmdb.yearFilter')?.value);
                    tmdb.yearFilter = expr;
                }
                // Selected genres as CSV from hidden field
                tmdb.genreFilter = getTMDBGenreFilterHidden();
                const tmdbApiKeyVal = getInput('tmdb.apikey')?.value || '';
                if (tmdbApiKeyVal && tmdbApiKeyVal !== '••••••••') tmdb.apiKey = tmdbApiKeyVal;
                // Include Streaming Releases selections (server converts object -> array)
                const streaming = {
                    enabled: !!document.getElementById('streamingSources.enabled')?.checked,
                    region: document.getElementById('streamingSources.region')?.value || 'US',
                    minRating:
                        toInt(document.getElementById('streamingSources.minRating')?.value) ?? 0,
                    // Map multiselect selections back to boolean flags
                    ...(() => {
                        const sel = new Set(getMultiSelectValues('streaming.providers'));
                        return {
                            netflix: sel.has('netflix'),
                            disney: sel.has('disney'),
                            prime: sel.has('prime'),
                            hbo: sel.has('hbo'),
                            hulu: sel.has('hulu'),
                            apple: sel.has('apple'),
                            paramount: sel.has('paramount'),
                            crunchyroll: sel.has('crunchyroll'),
                        };
                    })(),
                    newReleases: !!document.getElementById('streamingSources.newReleases')?.checked,
                };
                await saveConfigPatch({ tmdbSource: tmdb, streamingSources: streaming });
                window.notify?.toast({
                    type: 'success',
                    title: 'Saved',
                    message: 'TMDB settings updated',
                    duration: 2500,
                });
            } catch (e) {
                window.notify?.toast({
                    type: 'error',
                    title: 'Save failed',
                    message: e?.message || 'Unable to save TMDB',
                    duration: 4500,
                });
            } finally {
                btn?.classList.remove('btn-loading');
                loadMediaSources()
                    .then(() => {
                        // Ensure TMDB genres UI stays hydrated after save
                        try {
                            const curr = getTMDBGenreFilterHidden();
                            loadTMDBGenres(curr).catch(() => {});
                        } catch (_) {
                            /* no-op */
                        }
                    })
                    .catch(() => {});
            }
        }

        // ------- TMDB Genre Filter (theme-demo multiselect) -------
        function setTMDBGenreFilterHidden(val) {
            const hidden = document.getElementById('tmdb.genreFilter-hidden');
            if (hidden) hidden.value = val || '';
        }
        function getTMDBGenreFilterHidden() {
            const hidden = document.getElementById('tmdb.genreFilter-hidden');
            return hidden ? hidden.value : '';
        }
        // Build option row
        function tmdbMsOption(name, checked) {
            const row = document.createElement('div');
            row.className = 'ms-option';
            row.setAttribute('role', 'option');
            row.dataset.value = name;
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = !!checked;
            const label = document.createElement('span');
            label.textContent = name;
            row.appendChild(cb);
            row.appendChild(label);
            return row;
        }
        function tmdbRenderChips(selected) {
            const chipsEl = document.getElementById('tmdb-ms-genres-chips');
            const control = document.querySelector('#tmdb-ms-genres .ms-control');
            if (!chipsEl || !control) return;
            chipsEl.innerHTML = '';
            const vals = Array.from(selected);
            vals.forEach(v => {
                const chip = document.createElement('span');
                chip.className = 'ms-chip';
                chip.dataset.value = v;
                chip.innerHTML = `${v} <i class="fas fa-xmark ms-chip-remove" title="Remove"></i>`;
                chip.querySelector('.ms-chip-remove').addEventListener('click', e => {
                    e.stopPropagation();
                    selected.delete(v);
                    setTMDBGenreFilterHidden(Array.from(selected).join(','));
                    tmdbSyncOptions(selected);
                    tmdbRenderChips(selected);
                    control.classList.toggle('has-selection', selected.size > 0);
                });
                chipsEl.appendChild(chip);
            });
            control.classList.toggle('has-selection', selected.size > 0);
        }
        function tmdbSyncOptions(selected) {
            document.querySelectorAll('#tmdb-ms-genres-options .ms-option').forEach(opt => {
                const v = opt.dataset.value;
                const cb = opt.querySelector('input[type="checkbox"]');
                if (cb) cb.checked = selected.has(v);
            });
        }
        function tmdbOpenMenu(open) {
            const root = document.getElementById('tmdb-ms-genres');
            const control = root?.querySelector('.ms-control');
            if (!root || !control) return;
            root.classList.toggle('ms-open', !!open);
            control.setAttribute('aria-expanded', open ? 'true' : 'false');
        }
        function tmdbAttachMsHandlers(options, selected) {
            const root = document.getElementById('tmdb-ms-genres');
            if (!root) return;
            if (root.dataset.msWired === 'true') return; // avoid duplicate listeners
            const control = root?.querySelector('.ms-control');
            // no top input; use search field inside menu
            // const input = null;
            const menu = document.getElementById('tmdb-ms-genres-menu');
            const search = document.getElementById('tmdb-ms-genres-search');
            const selectAll = document.getElementById('tmdb-ms-genres-select-all');
            const clearAll = document.getElementById('tmdb-ms-genres-clear-all');
            const clearBtn = document.getElementById('tmdb-ms-genres-clear');
            const optsEl = document.getElementById('tmdb-ms-genres-options');
            if (!root || !control || !menu || !search || !selectAll || !clearAll || !optsEl) return;

            const filterOptions = q => {
                const qq = (q || '').toLowerCase();
                Array.from(optsEl.children).forEach(child => {
                    const match = child.dataset.value?.toLowerCase().includes(qq);
                    child.style.display = match ? '' : 'none';
                });
            };
            // Open/close on mousedown to avoid focus-before-click flicker.
            // Ignore when user clicks directly in the input (typing should just open via focus).
            control.addEventListener('mousedown', e => {
                // No top input anymore
                e.preventDefault();
                e.stopPropagation();
                const willOpen = !root.classList.contains('ms-open');
                tmdbOpenMenu(willOpen);
                if (willOpen) setTimeout(() => search.focus(), 0);
            });
            document.addEventListener('click', e => {
                if (!root.contains(e.target)) tmdbOpenMenu(false);
            });
            // Focus/typing only in bottom search now
            search.addEventListener('focus', () => tmdbOpenMenu(true));
            search.addEventListener('keydown', e => {
                if (e.key === 'Escape') tmdbOpenMenu(false);
            });
            // Search typing filters list
            search.addEventListener('input', () => filterOptions(search.value));
            // Select all
            selectAll.addEventListener('click', e => {
                e.preventDefault();
                options.forEach(name => selected.add(name));
                setTMDBGenreFilterHidden(Array.from(selected).join(','));
                tmdbSyncOptions(selected);
                tmdbRenderChips(selected);
            });
            // Clear all
            clearAll.addEventListener('click', e => {
                e.preventDefault();
                selected.clear();
                setTMDBGenreFilterHidden('');
                tmdbSyncOptions(selected);
                tmdbRenderChips(selected);
            });
            clearBtn?.addEventListener('click', e => {
                e.preventDefault();
                selected.clear();
                setTMDBGenreFilterHidden('');
                tmdbSyncOptions(selected);
                tmdbRenderChips(selected);
                // Also clear search
                search.value = '';
                filterOptions('');
            });
            // Option click
            optsEl.addEventListener('click', e => {
                const row = e.target.closest('.ms-option');
                if (!row) return;
                const v = row.dataset.value;
                if (selected.has(v)) selected.delete(v);
                else selected.add(v);
                setTMDBGenreFilterHidden(Array.from(selected).join(','));
                tmdbSyncOptions(selected);
                tmdbRenderChips(selected);
            });
            root.dataset.msWired = 'true';
        }
        async function loadTMDBGenres(currentValueCsv = '') {
            const chipsContainer = document.getElementById('tmdb-ms-genres-chips');
            const optsEl = document.getElementById('tmdb-ms-genres-options');
            const control = document.querySelector('#tmdb-ms-genres .ms-control');
            if (!chipsContainer || !optsEl || !control) return;
            chipsContainer.innerHTML = '<div class="subtle">Loading genres…</div>';
            try {
                // Try server-provided genre list
                const r = await window.dedupJSON('/api/admin/tmdb-genres', {
                    credentials: 'include',
                });
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                const data = await r.json().catch(() => ({}));
                const genres = Array.isArray(data?.genres) ? data.genres : [];
                // Build sorted option list
                const names = genres
                    .slice()
                    .map(g => g.name || g.value || String(g))
                    .sort((a, b) => a.localeCompare(b));
                optsEl.innerHTML = '';
                const selected = new Set(
                    String(currentValueCsv || '')
                        .split(',')
                        .map(s => s.trim())
                        .filter(Boolean)
                );
                names.forEach(n => optsEl.appendChild(tmdbMsOption(n, selected.has(n))));
                setTMDBGenreFilterHidden(Array.from(selected).join(','));
                tmdbRenderChips(selected);
                tmdbAttachMsHandlers(names, selected);
            } catch (e) {
                chipsContainer.innerHTML = '<div class="subtle">Failed to load genres</div>';
            }
        }

        // ------- Plex Ratings/Qualities (theme-demo multiselects) -------
        function setPlexHidden(id, val) {
            const el = document.getElementById(id);
            if (el) {
                el.value = val || '';
                try {
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                } catch (_) {}
            }
        }
        function getPlexHidden(id) {
            const el = document.getElementById(id);
            return el ? el.value : '';
        }
        function plexMsOption(name, checked) {
            const row = document.createElement('div');
            row.className = 'ms-option';
            row.setAttribute('role', 'option');
            row.dataset.value = name;
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = !!checked;
            const label = document.createElement('span');
            label.textContent = name;
            row.appendChild(cb);
            row.appendChild(label);
            return row;
        }
        function plexAttachMsHandlers(baseId, options, selected, onUpdate) {
            const root = document.getElementById(baseId);
            if (!root || root.dataset.msWired === 'true') return;
            const control = root.querySelector('.ms-control');
            const menu = document.getElementById(baseId + '-menu');
            const search = document.getElementById(baseId + '-search');
            const selectAll = document.getElementById(baseId + '-select-all');
            const clearAll = document.getElementById(baseId + '-clear-all');
            const clearBtn = document.getElementById(baseId + '-clear');
            const optsEl = document.getElementById(baseId + '-options');
            const chips = document.getElementById(baseId + '-chips');
            if (!control || !menu || !search || !selectAll || !clearAll || !optsEl || !chips)
                return;
            const renderChips = () => {
                chips.innerHTML = '';
                Array.from(selected).forEach(v => {
                    const chip = document.createElement('span');
                    chip.className = 'ms-chip';
                    chip.dataset.value = v;
                    chip.innerHTML = `${v} <i class="fas fa-xmark ms-chip-remove" title="Remove"></i>`;
                    chip.querySelector('.ms-chip-remove')?.addEventListener('click', e => {
                        e.stopPropagation();
                        selected.delete(v);
                        onUpdate(selected);
                        syncOptions();
                        renderChips();
                        control.classList.toggle('has-selection', selected.size > 0);
                    });
                    chips.appendChild(chip);
                });
                control.classList.toggle('has-selection', selected.size > 0);
            };
            const syncOptions = () => {
                Array.from(optsEl.children).forEach(row => {
                    const v = row.dataset.value;
                    const cb = row.querySelector('input[type="checkbox"]');
                    if (cb) cb.checked = selected.has(v);
                });
            };
            // Move menu into body to avoid clipping and position it near control
            if (menu && menu.parentElement !== document.body) {
                document.body.appendChild(menu);
                menu.style.position = 'fixed';
                menu.style.zIndex = '9999';
                menu.style.display = 'none';
                menu.style.maxHeight = '60vh';
                menu.style.overflow = 'auto';
                menu.style.minWidth = '240px';
            }
            let onReposition;
            const positionMenu = () => {
                if (!control || !menu) return;
                const rect = control.getBoundingClientRect();
                const viewportH = window.innerHeight || document.documentElement.clientHeight;
                const belowSpace = viewportH - rect.bottom;
                const estHeight = Math.min(menu.scrollHeight || 320, viewportH * 0.6);
                const openUp = belowSpace < estHeight && rect.top > estHeight;
                const top = openUp ? Math.max(8, rect.top - estHeight) : rect.bottom + 4;
                const left = rect.left;
                const width = Math.max(rect.width, 240);
                menu.style.top = `${Math.round(top)}px`;
                menu.style.left = `${Math.round(left)}px`;
                menu.style.width = `${Math.round(width)}px`;
                menu.style.maxHeight = `${Math.round(estHeight)}px`;
            };
            const openMenu = open => {
                root.classList.toggle('ms-open', !!open);
                control.setAttribute('aria-expanded', open ? 'true' : 'false');
                if (!menu) return;
                if (open) {
                    menu.style.display = 'block';
                    try {
                        menu.scrollTop = 0;
                        if (optsEl) optsEl.scrollTop = 0;
                    } catch (e) {
                        dbg('ms scroll reset failed (plex)', e);
                    }
                    positionMenu();
                    onReposition = () => positionMenu();
                    window.addEventListener('resize', onReposition, { passive: true });
                    window.addEventListener('scroll', onReposition, { passive: true });
                } else {
                    menu.style.display = 'none';
                    if (onReposition) {
                        window.removeEventListener('resize', onReposition);
                        window.removeEventListener('scroll', onReposition);
                        onReposition = null;
                    }
                }
            };
            const filterOptions = q => {
                const qq = (q || '').toLowerCase();
                Array.from(optsEl.children).forEach(child => {
                    const match = child.dataset.value?.toLowerCase().includes(qq);
                    child.style.display = match ? '' : 'none';
                });
            };
            control.addEventListener('mousedown', e => {
                e.preventDefault();
                e.stopPropagation();
                const willOpen = !root.classList.contains('ms-open');
                openMenu(willOpen);
                if (willOpen) setTimeout(() => search.focus(), 0);
            });
            document.addEventListener('click', e => {
                if (!root.contains(e.target) && !(menu && menu.contains(e.target))) openMenu(false);
            });
            search.addEventListener('focus', () => openMenu(true));
            search.addEventListener('keydown', e => {
                if (e.key === 'Escape') openMenu(false);
            });
            search.addEventListener('input', () => filterOptions(search.value));
            selectAll.addEventListener('click', e => {
                e.preventDefault();
                options.forEach(n => selected.add(n));
                onUpdate(selected);
                syncOptions();
                renderChips();
            });
            clearAll.addEventListener('click', e => {
                e.preventDefault();
                selected.clear();
                onUpdate(selected);
                syncOptions();
                renderChips();
                search.value = '';
                filterOptions('');
            });
            clearBtn?.addEventListener('click', e => {
                e.preventDefault();
                selected.clear();
                onUpdate(selected);
                syncOptions();
                renderChips();
                search.value = '';
                filterOptions('');
            });
            optsEl.addEventListener('click', e => {
                const row = e.target.closest('.ms-option');
                if (!row) return;
                const v = row.dataset.value;
                if (selected.has(v)) selected.delete(v);
                else selected.add(v);
                onUpdate(selected);
                syncOptions();
                renderChips();
            });
            root.dataset.msWired = 'true';
            renderChips();
        }
        async function loadPlexRatings(currentCsv = '') {
            const chips = document.getElementById('plex-ms-ratings-chips');
            const optsEl = document.getElementById('plex-ms-ratings-options');
            const control = document.querySelector('#plex-ms-ratings .ms-control');
            const root = document.getElementById('plex-ms-ratings');
            if (!chips || !optsEl || !control) return;
            chips.innerHTML = '<div class="subtle">Loading ratings…</div>';
            try {
                const res = await window.dedupJSON('/api/sources/plex/ratings-with-counts', {
                    credentials: 'include',
                });
                const data = await res.json().catch(() => ({}));
                const arr = Array.isArray(data?.data) ? data.data : [];
                const ratings = arr
                    .map(r => r.rating)
                    .filter(Boolean)
                    .sort();
                const selected = new Set(
                    String(currentCsv || '')
                        .split(',')
                        .map(s => s.trim())
                        .filter(Boolean)
                );
                optsEl.innerHTML = '';
                ratings.forEach(n => optsEl.appendChild(plexMsOption(n, selected.has(n))));
                setPlexHidden('plex.ratingFilter-hidden', Array.from(selected).join(','));
                if (root?.dataset.msWired === 'true') {
                    const syncOptions = () => {
                        Array.from(optsEl.children).forEach(row => {
                            const v = row.dataset.value;
                            const cb = row.querySelector('input[type="checkbox"]');
                            if (cb) cb.checked = selected.has(v);
                        });
                    };
                    const renderChips = () => {
                        chips.innerHTML = '';
                        Array.from(selected).forEach(v => {
                            const chip = document.createElement('span');
                            chip.className = 'ms-chip';
                            chip.dataset.value = v;
                            chip.innerHTML = `${v} <i class="fas fa-xmark ms-chip-remove" title="Remove"></i>`;
                            chip.querySelector('.ms-chip-remove')?.addEventListener('click', e => {
                                e.stopPropagation();
                                selected.delete(v);
                                setPlexHidden(
                                    'plex.ratingFilter-hidden',
                                    Array.from(selected).join(',')
                                );
                                syncOptions();
                                renderChips();
                                control.classList.toggle('has-selection', selected.size > 0);
                            });
                            chips.appendChild(chip);
                        });
                        control.classList.toggle('has-selection', selected.size > 0);
                    };
                    syncOptions();
                    renderChips();
                } else {
                    plexAttachMsHandlers('plex-ms-ratings', ratings, selected, sel =>
                        setPlexHidden('plex.ratingFilter-hidden', Array.from(sel).join(','))
                    );
                }
            } catch (e) {
                chips.innerHTML = '<div class="subtle">Failed to load ratings</div>';
            }
        }
        async function loadPlexQualities(currentCsv = '') {
            const chips = document.getElementById('plex-ms-qualities-chips');
            const optsEl = document.getElementById('plex-ms-qualities-options');
            const control = document.querySelector('#plex-ms-qualities .ms-control');
            const root = document.getElementById('plex-ms-qualities');
            if (!chips || !optsEl || !control) return;
            chips.innerHTML = '<div class="subtle">Loading qualities…</div>';
            try {
                const res = await window.dedupJSON('/api/admin/plex-qualities-with-counts', {
                    credentials: 'include',
                });
                const data = await res.json().catch(() => ({}));
                const arr = Array.isArray(data?.qualities) ? data.qualities : [];
                const names = arr
                    .map(q => q.quality || q)
                    .filter(Boolean)
                    .sort((a, b) => {
                        const order = ['SD', '720p', '1080p', '4K'];
                        const ai = order.indexOf(a);
                        const bi = order.indexOf(b);
                        if (ai !== -1 && bi !== -1) return ai - bi;
                        if (ai !== -1) return -1;
                        if (bi !== -1) return 1;
                        return a.localeCompare(b);
                    });
                const selected = new Set(
                    String(currentCsv || '')
                        .split(',')
                        .map(s => s.trim())
                        .filter(Boolean)
                );
                optsEl.innerHTML = '';
                names.forEach(n => optsEl.appendChild(plexMsOption(n, selected.has(n))));
                setPlexHidden('plex.qualityFilter-hidden', Array.from(selected).join(','));
                if (root?.dataset.msWired === 'true') {
                    const syncOptions = () => {
                        Array.from(optsEl.children).forEach(row => {
                            const v = row.dataset.value;
                            const cb = row.querySelector('input[type="checkbox"]');
                            if (cb) cb.checked = selected.has(v);
                        });
                    };
                    const renderChips = () => {
                        chips.innerHTML = '';
                        Array.from(selected).forEach(v => {
                            const chip = document.createElement('span');
                            chip.className = 'ms-chip';
                            chip.dataset.value = v;
                            chip.innerHTML = `${v} <i class="fas fa-xmark ms-chip-remove" title="Remove"></i>`;
                            chip.querySelector('.ms-chip-remove')?.addEventListener('click', e => {
                                e.stopPropagation();
                                selected.delete(v);
                                setPlexHidden(
                                    'plex.qualityFilter-hidden',
                                    Array.from(selected).join(',')
                                );
                                syncOptions();
                                renderChips();
                                control.classList.toggle('has-selection', selected.size > 0);
                            });
                            chips.appendChild(chip);
                        });
                        control.classList.toggle('has-selection', selected.size > 0);
                    };
                    syncOptions();
                    renderChips();
                } else {
                    plexAttachMsHandlers('plex-ms-qualities', names, selected, sel =>
                        setPlexHidden('plex.qualityFilter-hidden', Array.from(sel).join(','))
                    );
                }
            } catch (e) {
                chips.innerHTML = '<div class="subtle">Failed to load qualities</div>';
            }
        }

        async function saveTVDB() {
            const btn = document.getElementById('btn-save-tvdb');
            btn?.classList.add('btn-loading');
            try {
                const cfgRes = await window.dedupJSON('/api/admin/config', {
                    credentials: 'include',
                });
                const base = cfgRes.ok ? await cfgRes.json() : {};
                const currentCfg = base?.config || base || {};
                const tvdb = { ...(currentCfg.tvdbSource || {}) };
                tvdb.enabled = !!getInput('tvdb.enabled')?.checked;
                tvdb.category = getInput('tvdb.category')?.value || 'popular';
                {
                    const mr = toInt(getInput('tvdb.minRating')?.value);
                    tvdb.minRating = Number.isFinite(mr) ? mr : undefined;
                }
                {
                    const expr = parseYearExpression(getInput('tvdb.yearFilter')?.value);
                    tvdb.yearFilter = expr;
                }
                await saveConfigPatch({ tvdbSource: tvdb });
                window.notify?.toast({
                    type: 'success',
                    title: 'Saved',
                    message: 'TVDB settings updated',
                    duration: 2500,
                });
            } catch (e) {
                window.notify?.toast({
                    type: 'error',
                    title: 'Save failed',
                    message: e?.message || 'Unable to save TVDB',
                    duration: 4500,
                });
            } finally {
                btn?.classList.remove('btn-loading');
                loadMediaSources().catch(() => {});
            }
        }

        // Wire buttons
        document.getElementById('btn-plex-libraries')?.addEventListener('click', () => {
            fetchPlexLibraries(true);
        });
        document.getElementById('btn-jf-libraries')?.addEventListener('click', () => {
            fetchJellyfinLibraries(true);
        });
        document.getElementById('btn-plex-test')?.addEventListener('click', testPlex);
        document.getElementById('btn-jf-test')?.addEventListener('click', testJellyfin);
        document.getElementById('btn-tmdb-test')?.addEventListener('click', testTMDB);
        document.getElementById('test-streaming-button')?.addEventListener('click', testStreaming);
        // (deduped) listener already set above near other source listeners
        // Update category icon based on selection
        const tmdbCat = document.getElementById('tmdb.category');
        const tmdbCatIcon = document.getElementById('tmdb-category-icon')?.querySelector('i');
        const tvdbCat = document.getElementById('tvdb.category');
        const tvdbCatIcon = document.getElementById('tvdb-category-icon')?.querySelector('i');
        const iconFor = val => {
            switch (val) {
                // Shared
                case 'top_rated':
                case 'tv_top_rated':
                    return 'fas fa-star';
                case 'popular':
                case 'tv_popular':
                    return 'fas fa-fire';
                // Movies
                case 'now_playing':
                    return 'fas fa-ticket-alt';
                case 'upcoming':
                    return 'fas fa-calendar-alt';
                case 'latest':
                case 'tv_latest':
                    return 'fas fa-bolt';
                // TV specific
                case 'tv_on_the_air':
                    return 'fas fa-broadcast-tower';
                case 'tv_airing_today':
                    return 'fas fa-tv';
                // Trending
                case 'trending_all_day':
                case 'trending_movie_day':
                case 'trending_tv_day':
                case 'trending_all_week':
                case 'trending_movie_week':
                case 'trending_tv_week':
                    return 'fas fa-chart-line';
                // Discover/Collections
                case 'discover_movie':
                case 'discover_tv':
                    return 'fas fa-compass';
                // TVDB-specific fallbacks retained
                case 'recently_updated':
                    return 'fas fa-arrows-rotate';
                case 'newest':
                    return 'fas fa-film';
                case 'oldest':
                    return 'fas fa-hourglass-half';
                case 'recently_added':
                    return 'fas fa-plus';
                case 'alphabetical':
                    return 'fas fa-font';
                default:
                    return 'fas fa-list';
            }
        };
        // TMDB custom select + overlay icon
        if (tmdbCat && tmdbCatIcon) {
            tmdbCatIcon.className = iconFor(tmdbCat.value);
            tmdbCat.addEventListener('change', () => {
                tmdbCatIcon.className = iconFor(tmdbCat.value);
            });
            const wrap = tmdbCat.closest('.select-wrap');
            if (wrap) {
                wrap.classList.add('has-custom-select');
                tmdbCat.classList.add('enhanced');
                const custom = document.createElement('div');
                custom.className = 'custom-select';
                const trigger = document.createElement('button');
                trigger.type = 'button';
                trigger.className = 'custom-select-trigger';
                trigger.setAttribute('aria-haspopup', 'listbox');
                trigger.setAttribute('aria-expanded', 'false');
                const left = document.createElement('span');
                left.className = 'left';
                const ico = document.createElement('i');
                ico.className = iconFor(tmdbCat.value);
                const label = document.createElement('span');
                label.textContent = tmdbCat.options[tmdbCat.selectedIndex]?.text || 'Select';
                left.appendChild(ico);
                left.appendChild(label);
                const caret = document.createElement('i');
                caret.className = 'fas fa-chevron-down caret';
                trigger.appendChild(left);
                trigger.appendChild(caret);
                const list = document.createElement('div');
                list.className = 'custom-options';
                if (tmdbCat.id) list.setAttribute('data-select-id', tmdbCat.id);
                list.setAttribute('role', 'listbox');
                // Build options with optgroup headers to mirror legacy admin groups
                Array.from(tmdbCat.children).forEach(child => {
                    if (child.tagName === 'OPTGROUP') {
                        const header = document.createElement('div');
                        header.className = 'custom-optgroup';
                        header.textContent = child.label;
                        list.appendChild(header);
                        Array.from(child.children).forEach(opt => {
                            if (!opt.value) return;
                            const row = document.createElement('div');
                            row.className = 'custom-option';
                            row.setAttribute('role', 'option');
                            row.dataset.value = opt.value;
                            if (opt.selected) row.setAttribute('aria-selected', 'true');
                            const oi = document.createElement('i');
                            oi.className = iconFor(opt.value);
                            const ot = document.createElement('span');
                            ot.textContent = opt.text;
                            row.appendChild(oi);
                            row.appendChild(ot);
                            row.addEventListener('click', () => {
                                tmdbCat.value = opt.value;
                                tmdbCat.dispatchEvent(new Event('change', { bubbles: true }));
                                ico.className = iconFor(opt.value);
                                label.textContent = opt.text;
                                list.querySelectorAll(
                                    '.custom-option[aria-selected="true"]'
                                ).forEach(el => el.removeAttribute('aria-selected'));
                                row.setAttribute('aria-selected', 'true');
                                custom.classList.remove('open');
                                trigger.setAttribute('aria-expanded', 'false');
                                list.style.display = 'none';
                            });
                            list.appendChild(row);
                        });
                    } else if (child.tagName === 'OPTION') {
                        const opt = child;
                        if (!opt.value) return;
                        const row = document.createElement('div');
                        row.className = 'custom-option';
                        row.setAttribute('role', 'option');
                        row.dataset.value = opt.value;
                        if (opt.selected) row.setAttribute('aria-selected', 'true');
                        const oi = document.createElement('i');
                        oi.className = iconFor(opt.value);
                        const ot = document.createElement('span');
                        ot.textContent = opt.text;
                        row.appendChild(oi);
                        row.appendChild(ot);
                        row.addEventListener('click', () => {
                            tmdbCat.value = opt.value;
                            tmdbCat.dispatchEvent(new Event('change', { bubbles: true }));
                            ico.className = iconFor(opt.value);
                            label.textContent = opt.text;
                            list.querySelectorAll('.custom-option[aria-selected="true"]').forEach(
                                el => el.removeAttribute('aria-selected')
                            );
                            row.setAttribute('aria-selected', 'true');
                            custom.classList.remove('open');
                            trigger.setAttribute('aria-expanded', 'false');
                            list.style.display = 'none';
                        });
                        list.appendChild(row);
                    }
                });
                custom.appendChild(trigger);
                wrap.appendChild(custom);
                const positionList = () => {
                    const rect = trigger.getBoundingClientRect();
                    const viewportH = window.innerHeight || document.documentElement.clientHeight;
                    const belowSpace = viewportH - rect.bottom;
                    const aboveSpace = rect.top;
                    const desiredHeight = Math.min(260, Math.max(160, Math.floor(viewportH * 0.5)));
                    let top;
                    let maxHeight;
                    if (belowSpace >= 180 || belowSpace >= aboveSpace) {
                        top = rect.bottom + 6;
                        maxHeight = Math.min(desiredHeight, belowSpace - 12);
                    } else {
                        maxHeight = Math.min(desiredHeight, aboveSpace - 12);
                        top = Math.max(8, rect.top - maxHeight - 6);
                    }
                    Object.assign(list.style, {
                        display: 'block',
                        top: `${Math.round(top)}px`,
                        left: `${Math.round(rect.left)}px`,
                        width: `${Math.round(rect.width)}px`,
                        maxHeight: `${Math.max(140, maxHeight)}px`,
                    });
                };
                const openList = () => {
                    if (!document.body.contains(list)) document.body.appendChild(list);
                    positionList();
                    custom.classList.add('open');
                    trigger.setAttribute('aria-expanded', 'true');
                };
                const closeList = () => {
                    custom.classList.remove('open');
                    trigger.setAttribute('aria-expanded', 'false');
                    list.style.display = 'none';
                };
                const toggleOpen = () => {
                    if (custom.classList.contains('open')) closeList();
                    else openList();
                };
                trigger.addEventListener('click', e => {
                    e.stopPropagation();
                    toggleOpen();
                });
                document.addEventListener('click', e => {
                    if (
                        !custom.contains(e.target) &&
                        e.target !== list &&
                        !list.contains(e.target)
                    ) {
                        closeList();
                    }
                });
                window.addEventListener('resize', () => {
                    if (custom.classList.contains('open')) positionList();
                });
                window.addEventListener(
                    'scroll',
                    () => {
                        if (custom.classList.contains('open')) positionList();
                    },
                    { passive: true }
                );
                tmdbCat.addEventListener('change', () => {
                    ico.className = iconFor(tmdbCat.value);
                    label.textContent = tmdbCat.options[tmdbCat.selectedIndex]?.text || 'Select';
                    list.querySelectorAll('.custom-option').forEach(el => {
                        el.toggleAttribute('aria-selected', el.dataset.value === tmdbCat.value);
                    });
                });
                // Initial sync for trigger and list selection
                try {
                    syncCustomSelect(tmdbCat);
                } catch (_) {
                    // ignore
                }
            }
        }

        // Live auto-fetch libraries when connection inputs change (Plex/Jellyfin)
        // Simple debounce to avoid rapid calls while typing
        const debounce = (fn, ms = 300) => {
            let t;
            return (...args) => {
                clearTimeout(t);
                t = setTimeout(() => fn(...args), ms);
            };
        };

        const autoFetchPlexIfReady = debounce(() => {
            try {
                const enabled = !!document.getElementById('plex.enabled')?.checked;
                const host = document.getElementById('plex.hostname')?.value?.trim();
                const port = document.getElementById('plex.port')?.value?.trim();
                if (enabled && host && port) fetchPlexLibraries(true, true);
            } catch (_) {
                /* no-op */
            }
        }, 350);

        const autoFetchJfIfReady = debounce(() => {
            try {
                const enabled = !!document.getElementById('jf.enabled')?.checked;
                const host = document.getElementById('jf.hostname')?.value?.trim();
                const port = document.getElementById('jf.port')?.value?.trim();
                if (enabled && host && port) fetchJellyfinLibraries(true);
            } catch (_) {
                /* no-op */
            }
        }, 350);

        // Attach listeners
        ['plex.enabled', 'plex.hostname', 'plex.port'].forEach(id => {
            const el = document.getElementById(id);
            el?.addEventListener('change', autoFetchPlexIfReady);
            // For text inputs, also react on input typing
            if (el && el.tagName === 'INPUT' && el.type === 'text') {
                el.addEventListener('input', autoFetchPlexIfReady);
            }
        });
        ['jf.enabled', 'jf.hostname', 'jf.port'].forEach(id => {
            const el = document.getElementById(id);
            el?.addEventListener('change', autoFetchJfIfReady);
            if (el && el.tagName === 'INPUT' && el.type === 'text') {
                el.addEventListener('input', autoFetchJfIfReady);
            }
        });

        // TVDB custom select + overlay icon
        if (tvdbCat && tvdbCatIcon) {
            tvdbCatIcon.className = iconFor(tvdbCat.value);
            tvdbCat.addEventListener('change', () => {
                tvdbCatIcon.className = iconFor(tvdbCat.value);
            });

            // Build custom dropdown for iconized options
            const wrap = tvdbCat.closest('.select-wrap');
            if (wrap) {
                wrap.classList.add('has-custom-select');
                tvdbCat.classList.add('enhanced');
                const custom = document.createElement('div');
                custom.className = 'custom-select';
                const trigger = document.createElement('button');
                trigger.type = 'button';
                trigger.className = 'custom-select-trigger';
                trigger.setAttribute('aria-haspopup', 'listbox');
                trigger.setAttribute('aria-expanded', 'false');
                const left = document.createElement('span');
                left.className = 'left';
                const ico = document.createElement('i');
                ico.className = iconFor(tvdbCat.value);
                const label = document.createElement('span');
                label.textContent = tvdbCat.options[tvdbCat.selectedIndex]?.text || 'Select';
                left.appendChild(ico);
                left.appendChild(label);
                const caret = document.createElement('i');
                caret.className = 'fas fa-chevron-down caret';
                trigger.appendChild(left);
                trigger.appendChild(caret);
                const list = document.createElement('div');
                list.className = 'custom-options';
                if (tvdbCat.id) list.setAttribute('data-select-id', tvdbCat.id);
                list.setAttribute('role', 'listbox');
                // Build options with optgroup headers to mirror legacy admin
                Array.from(tvdbCat.children).forEach(child => {
                    if (child.tagName === 'OPTGROUP') {
                        const header = document.createElement('div');
                        header.className = 'custom-optgroup';
                        header.textContent = child.label; // includes emojis
                        list.appendChild(header);
                        Array.from(child.children).forEach(opt => {
                            if (!opt.value) return;
                            const row = document.createElement('div');
                            row.className = 'custom-option';
                            row.setAttribute('role', 'option');
                            row.dataset.value = opt.value;
                            if (opt.selected) row.setAttribute('aria-selected', 'true');
                            const oi = document.createElement('i');
                            oi.className = iconFor(opt.value);
                            const ot = document.createElement('span');
                            ot.textContent = opt.text; // includes emojis
                            row.appendChild(oi);
                            row.appendChild(ot);
                            row.addEventListener('click', () => {
                                tvdbCat.value = opt.value;
                                tvdbCat.dispatchEvent(new Event('change', { bubbles: true }));
                                ico.className = iconFor(opt.value);
                                label.textContent = opt.text;
                                list.querySelectorAll(
                                    '.custom-option[aria-selected="true"]'
                                ).forEach(el => el.removeAttribute('aria-selected'));
                                row.setAttribute('aria-selected', 'true');
                                custom.classList.remove('open');
                                trigger.setAttribute('aria-expanded', 'false');
                                list.style.display = 'none';
                            });
                            list.appendChild(row);
                        });
                    } else if (child.tagName === 'OPTION') {
                        const opt = child;
                        if (!opt.value) return;
                        const row = document.createElement('div');
                        row.className = 'custom-option';
                        row.setAttribute('role', 'option');
                        row.dataset.value = opt.value;
                        if (opt.selected) row.setAttribute('aria-selected', 'true');
                        const oi = document.createElement('i');
                        oi.className = iconFor(opt.value);
                        const ot = document.createElement('span');
                        ot.textContent = opt.text;
                        row.appendChild(oi);
                        row.appendChild(ot);
                        row.addEventListener('click', () => {
                            tvdbCat.value = opt.value;
                            tvdbCat.dispatchEvent(new Event('change', { bubbles: true }));
                            ico.className = iconFor(opt.value);
                            label.textContent = opt.text;
                            list.querySelectorAll('.custom-option[aria-selected="true"]').forEach(
                                el => el.removeAttribute('aria-selected')
                            );
                            row.setAttribute('aria-selected', 'true');
                            custom.classList.remove('open');
                            trigger.setAttribute('aria-expanded', 'false');
                            list.style.display = 'none';
                        });
                        list.appendChild(row);
                    }
                });
                custom.appendChild(trigger);
                // append custom container under wrap; list will be appended to body when opened
                wrap.appendChild(custom);
                // open/close handlers with viewport-aware positioning
                const positionList = () => {
                    const rect = trigger.getBoundingClientRect();
                    const viewportH = window.innerHeight || document.documentElement.clientHeight;
                    const belowSpace = viewportH - rect.bottom;
                    const aboveSpace = rect.top;
                    const desiredHeight = Math.min(260, Math.max(160, Math.floor(viewportH * 0.5)));
                    let top;
                    let maxHeight;
                    if (belowSpace >= 180 || belowSpace >= aboveSpace) {
                        top = rect.bottom + 6;
                        maxHeight = Math.min(desiredHeight, belowSpace - 12);
                    } else {
                        maxHeight = Math.min(desiredHeight, aboveSpace - 12);
                        top = Math.max(8, rect.top - maxHeight - 6);
                    }
                    Object.assign(list.style, {
                        display: 'block',
                        top: `${Math.round(top)}px`,
                        left: `${Math.round(rect.left)}px`,
                        width: `${Math.round(rect.width)}px`,
                        maxHeight: `${Math.max(140, maxHeight)}px`,
                    });
                };
                const openList = () => {
                    if (!document.body.contains(list)) document.body.appendChild(list);
                    positionList();
                    custom.classList.add('open');
                    trigger.setAttribute('aria-expanded', 'true');
                };
                const closeList = () => {
                    custom.classList.remove('open');
                    trigger.setAttribute('aria-expanded', 'false');
                    list.style.display = 'none';
                };
                const toggleOpen = () => {
                    if (custom.classList.contains('open')) closeList();
                    else openList();
                };
                trigger.addEventListener('click', e => {
                    e.stopPropagation();
                    toggleOpen();
                });
                document.addEventListener('click', e => {
                    if (
                        !custom.contains(e.target) &&
                        e.target !== list &&
                        !list.contains(e.target)
                    ) {
                        closeList();
                    }
                });
                window.addEventListener('resize', () => {
                    if (custom.classList.contains('open')) positionList();
                });
                window.addEventListener(
                    'scroll',
                    () => {
                        if (custom.classList.contains('open')) positionList();
                    },
                    { passive: true }
                );
                // keep external changes in sync
                tvdbCat.addEventListener('change', () => {
                    ico.className = iconFor(tvdbCat.value);
                    label.textContent = tvdbCat.options[tvdbCat.selectedIndex]?.text || 'Select';
                    list.querySelectorAll('.custom-option').forEach(el => {
                        el.toggleAttribute('aria-selected', el.dataset.value === tvdbCat.value);
                    });
                });
                // Initial sync for trigger and list selection
                try {
                    syncCustomSelect(tvdbCat);
                } catch (_) {
                    // ignore
                }
            }
        }
        document.getElementById('btn-tvdb-test')?.addEventListener('click', testTVDB);
        document.getElementById('btn-save-plex')?.addEventListener('click', savePlex);
        document.getElementById('btn-save-jellyfin')?.addEventListener('click', saveJellyfin);
        document.getElementById('btn-save-tmdb')?.addEventListener('click', saveTMDB);
        document.getElementById('btn-save-tvdb')?.addEventListener('click', saveTVDB);
        // No extra handlers needed here; dependent refresh is driven by fetchPlexLibraries(true)

        // Initial population
        loadMediaSources()
            .then(() => dbg('loadMediaSources() initial done'))
            .catch(err => dbg('loadMediaSources() initial failed', err));

        btnSaveServer?.addEventListener('click', async () => {
            const debugEl = document.getElementById('DEBUG');
            const DEBUG = !!debugEl?.checked;
            const portEl = document.getElementById('SERVER_PORT');
            const serverPort = Math.max(1024, Math.min(65535, Number(portEl?.value || 4000)));
            if (!Number.isFinite(serverPort) || serverPort < 1024 || serverPort > 65535) {
                return window.notify?.toast({
                    type: 'warning',
                    title: 'Invalid Port',
                    message: 'Port must be between 1024 and 65535',
                    duration: 4000,
                });
            }
            try {
                btnSaveServer.classList.add('btn-loading');
                await saveConfigPatch(
                    { serverPort },
                    { DEBUG: String(DEBUG), SERVER_PORT: String(serverPort) }
                );
                window.notify?.toast({
                    type: 'success',
                    title: 'Saved',
                    message: 'Server settings updated',
                    duration: 2500,
                });
            } catch (e) {
                window.notify?.toast({
                    type: 'error',
                    title: 'Save failed',
                    message: e?.message || 'Unable to save',
                    duration: 4500,
                });
            } finally {
                btnSaveServer.classList.remove('btn-loading');
            }
        });

        btnSavePromo?.addEventListener('click', async () => {
            const enabled = !!document.getElementById('siteServer.enabled')?.checked;
            const portVal = Number(document.getElementById('siteServer.port')?.value || 4001);
            try {
                btnSavePromo.classList.add('btn-loading');
                await saveConfigPatch({ siteServer: { enabled, port: portVal } }, {});
                window.notify?.toast({
                    type: 'success',
                    title: 'Saved',
                    message: 'Promobox settings updated',
                    duration: 2500,
                });
            } catch (e) {
                window.notify?.toast({
                    type: 'error',
                    title: 'Save failed',
                    message: e?.message || 'Unable to save',
                    duration: 4500,
                });
            } finally {
                btnSavePromo.classList.remove('btn-loading');
            }
        });

        // Helper: update Operations save button label depending on restart requirement
        function opsRestartNeeded() {
            const portEl = document.getElementById('SERVER_PORT');
            const btn = document.getElementById('btn-save-operations');
            if (!portEl || !btn) return false;
            let original = btn.dataset.originalPort || portEl.dataset.originalPort;
            // If original not known yet, treat current value as original to avoid false positives
            if (original == null) {
                original = String(portEl.value || '4000');
                btn.dataset.originalPort = original;
                portEl.dataset.originalPort = original;
            }
            const current = Number(portEl.value || 4000);
            const origNum = Number(original);
            if (!Number.isFinite(current) || !Number.isFinite(origNum)) return false;
            return current !== origNum;
        }
        function updateOpsSaveButtonLabel() {
            const btn = document.getElementById('btn-save-operations');
            if (!btn) return;
            const span = btn.querySelector('span');
            const needs = opsRestartNeeded();
            if (span) span.textContent = needs ? 'Save Settings & Restart' : 'Save Settings';
            btn.dataset.restartRequired = needs ? 'true' : 'false';
        }
        // Update Debug status pill
        function updateDebugPill() {
            const chk = document.getElementById('DEBUG');
            const pill = document.getElementById('debug-status-pill');
            if (!pill || !chk) return;
            const on = !!chk.checked;
            pill.textContent = on ? 'Debug: On' : 'Debug: Off';
            pill.classList.toggle('status-warning', on);
            // Neutral (no class) when off; ensure success not lingering
            pill.classList.remove('status-success');
        }
        // Expose for later use after async loads
        window.updateOpsSaveButtonLabel = updateOpsSaveButtonLabel;
        // Wire live updates on port input
        if (portInput) {
            ['input', 'change'].forEach(evt =>
                portInput.addEventListener(evt, updateOpsSaveButtonLabel)
            );
        }
        // Wire Debug pill updates
        document.getElementById('DEBUG')?.addEventListener('change', updateDebugPill);
        // Initialize once
        updateDebugPill();

        // Unified save for Operations: saves both Server Settings and Promobox
        btnSaveOps?.addEventListener('click', async () => {
            const btn = btnSaveOps;
            try {
                // Collect Server Settings
                const DEBUG = !!document.getElementById('DEBUG')?.checked;
                const portEl = document.getElementById('SERVER_PORT');
                const serverPort = Math.max(1024, Math.min(65535, Number(portEl?.value || 4000)));
                if (!Number.isFinite(serverPort) || serverPort < 1024 || serverPort > 65535) {
                    return window.notify?.toast({
                        type: 'warning',
                        title: 'Invalid Port',
                        message: 'Port must be between 1024 and 65535',
                        duration: 4000,
                    });
                }
                // Collect Background Refresh Minutes (Media)
                const brmInput = document.getElementById('ops.backgroundRefreshMinutes');
                let backgroundRefreshMinutes = Number(brmInput?.value || 30);
                if (!Number.isFinite(backgroundRefreshMinutes)) backgroundRefreshMinutes = 30;
                backgroundRefreshMinutes = Math.max(
                    5,
                    Math.min(1440, Math.round(backgroundRefreshMinutes))
                );
                if (brmInput) brmInput.value = String(backgroundRefreshMinutes);
                if (!btn.querySelector('.spinner')) {
                    const sp = document.createElement('span');
                    sp.className = 'spinner';
                    btn.insertBefore(sp, btn.firstChild);
                }
                btn.classList.add('btn-loading');
                // Collect Promobox
                const enabled = !!document.getElementById('siteServer.enabled')?.checked;
                const portVal = Number(document.getElementById('siteServer.port')?.value || 4001);

                await saveConfigPatch(
                    {
                        serverPort: serverPort,
                        backgroundRefreshMinutes,
                        siteServer: { enabled, port: portVal },
                    },
                    { DEBUG: String(DEBUG), SERVER_PORT: String(serverPort) }
                );

                const needsRestart = btn.dataset.restartRequired === 'true' || opsRestartNeeded();
                if (needsRestart) {
                    // Immediately trigger restart
                    window.notify?.toast({
                        type: 'info',
                        title: 'Restarting…',
                        message: 'Port changed. Applying changes and restarting.',
                        duration: 0,
                    });
                    try {
                        await fetch('/api/admin/restart-app', {
                            method: 'POST',
                            credentials: 'include',
                        });
                    } catch (_) {
                        // Non-fatal: server may restart before responding
                    }
                } else {
                    window.notify?.toast({
                        type: 'success',
                        title: 'Saved',
                        message: 'Operations settings updated',
                        duration: 2500,
                    });
                }
            } catch (e) {
                window.notify?.toast({
                    type: 'error',
                    title: 'Save failed',
                    message: e?.message || 'Unable to save',
                    duration: 4500,
                });
            } finally {
                btn.classList.remove('btn-loading');
            }
        });

        // Toggle port/status visibility
        const promoEnabled = document.getElementById('siteServer.enabled');
        promoEnabled?.addEventListener('change', async () => {
            const show = promoEnabled.checked;
            const portGroup = document.getElementById('siteServerPortGroup');
            const status = document.getElementById('siteServerStatus');
            const pill = document.getElementById('siteServer-pill');
            if (portGroup) portGroup.style.display = show ? 'block' : 'none';
            if (status) {
                status.style.display = show ? 'block' : 'none';
                if (show) {
                    try {
                        // Fetch current server info to get an IP if exposed; otherwise, use the current host
                        const cfgRes = await window.dedupJSON('/api/admin/config', {
                            credentials: 'include',
                        });
                        const cfg = cfgRes.ok ? await cfgRes.json() : {};
                        const hostFromApi = cfg?.server?.ipAddress;
                        const host =
                            hostFromApi && hostFromApi !== '127.0.0.1'
                                ? hostFromApi
                                : window.location?.hostname || 'localhost';
                        const protocol = 'http';
                        const port = Number(
                            document.getElementById('siteServer.port')?.value || 4001
                        );
                        const url = `${protocol}://${host}:${port}`;
                        status.innerHTML = `<div class="status-line"><i class="fas fa-globe"></i> <a class="url-chip" href="${url}" target="_blank" rel="noopener">${url}</a></div>`;
                    } catch {
                        const host = window.location?.hostname || 'localhost';
                        const protocol = 'http';
                        const port = Number(
                            document.getElementById('siteServer.port')?.value || 4001
                        );
                        const url = `${protocol}://${host}:${port}`;
                        status.innerHTML = `<div class="status-line"><i class="fas fa-globe"></i> <a class="url-chip" href="${url}" target="_blank" rel="noopener">${url}</a></div>`;
                    }
                } else {
                    status.textContent = '';
                }
            }
            if (pill) {
                pill.textContent = show ? 'Enabled' : 'Disabled';
                pill.classList.toggle('status-warning', !show);
                pill.classList.toggle('status-success', !!show);
            }
        });
    });
    // If the DOM is already loaded, run wireEvents immediately
    try {
        if (document.readyState !== 'loading') {
            typeof wireEvents === 'function' && wireEvents();
            try {
                wireDashboardMetricShortcuts();
            } catch (_) {}
        }
    } catch (_) {}

    async function refreshOperationsPanels() {
        try {
            const r = await window.dedupJSON('/api/admin/config', { credentials: 'include' });
            const j = r.ok ? await r.json() : null;
            const env = j?.env || {};
            const cfg = j?.config || {};
            // DEBUG
            const debugEl = document.getElementById('DEBUG');
            if (debugEl) debugEl.checked = env.DEBUG === true || env.DEBUG === 'true';
            // SERVER_PORT
            const portElMain = document.getElementById('SERVER_PORT');
            if (portElMain) {
                const v = j?.env?.SERVER_PORT || cfg?.serverPort || 4000;
                portElMain.value = Number(v) || 4000;
                // Snapshot original for restart detection in unified save
                portElMain.dataset.originalPort = String(portElMain.value);
            }
            // Background Refresh Minutes (Media)
            const brmEl = document.getElementById('ops.backgroundRefreshMinutes');
            if (brmEl) {
                const v = Number(cfg?.backgroundRefreshMinutes ?? 30);
                brmEl.value = Number.isFinite(v) && v > 0 ? String(v) : '30';
            }
            // Promobox
            const site = cfg.siteServer || {};
            const enabledEl = document.getElementById('siteServer.enabled');
            const portEl = document.getElementById('siteServer.port');
            const portGroup = document.getElementById('siteServerPortGroup');
            const status = document.getElementById('siteServerStatus');
            const sitePill = document.getElementById('siteServer-pill');
            if (enabledEl) enabledEl.checked = !!site.enabled;
            if (portEl) portEl.value = site.port || 4001;
            if (portGroup) portGroup.style.display = site.enabled ? 'block' : 'none';
            if (status) {
                status.style.display = site.enabled ? 'block' : 'none';
                if (site.enabled) {
                    const hostFromApi = j?.server?.ipAddress;
                    const host =
                        hostFromApi && hostFromApi !== '127.0.0.1'
                            ? hostFromApi
                            : window.location?.hostname || 'localhost';
                    const protocol = 'http';
                    const port = site.port || 4001;
                    const url = `${protocol}://${host}:${port}`;
                    status.innerHTML = `<div class="status-line"><i class="fas fa-globe"></i> <a class="url-chip" href="${url}" target="_blank" rel="noopener">${url}</a></div>`;
                } else {
                    status.textContent = '';
                }
            }
            if (sitePill) {
                sitePill.textContent = site.enabled ? 'Enabled' : 'Disabled';
                sitePill.classList.toggle('status-warning', !site.enabled);
                sitePill.classList.toggle('status-success', !!site.enabled);
            }
            // Debug pill initial sync
            try {
                const dbgPill = document.getElementById('debug-status-pill');
                if (dbgPill) {
                    const on = !!(env.DEBUG === true || env.DEBUG === 'true');
                    dbgPill.textContent = on ? 'Debug: On' : 'Debug: Off';
                    dbgPill.classList.toggle('status-warning', on);
                    dbgPill.classList.remove('status-success');
                }
            } catch (_) {
                /* no-op */
            }
            // Ensure the unified save button label is correct after loading
            if (typeof window.updateOpsSaveButtonLabel === 'function') {
                window.updateOpsSaveButtonLabel();
            }
        } catch (e) {
            // non-fatal
        }
    }

    // Version + update pill
    async function refreshVersionAndUpdate() {
        try {
            // Get current version
            const v = await fetchJSON('/api/admin/version').catch(() => null);
            const version = v?.version || 'Unknown';
            const vEl = document.getElementById('app-version');
            if (vEl) vEl.textContent = version !== 'Unknown' ? `${version}` : '—';

            // Check for updates
            const upd = await fetchJSON('/api/admin/update-check').catch(() => null);
            const hasUpdate = !!upd?.hasUpdate;
            const latest = upd?.latestVersion;
            const pill = document.getElementById('update-available-pill');
            if (pill) {
                if (hasUpdate && latest && latest !== version) {
                    pill.hidden = false;
                    pill.textContent = 'Update available';
                    pill.title = `Latest: v${latest}`;
                } else {
                    pill.hidden = true;
                }
            }

            // Also reflect availability in the Automatic Updates card (idle pill)
            try {
                const idlePill = document.getElementById('update-idle-pill');
                const progState = document.getElementById('update-progress-state');
                // Only adjust when not actively updating
                const isProgressVisible = !!progState && progState.style.display !== 'none';
                if (idlePill && !isProgressVisible) {
                    if (hasUpdate && latest && latest !== version) {
                        idlePill.textContent = 'Update available';
                        idlePill.classList.remove('status-success');
                        idlePill.classList.add('status-warning');
                        idlePill.title = `Latest: v${latest}`;
                    } else {
                        idlePill.textContent = 'Ready';
                        idlePill.classList.remove('status-warning');
                        idlePill.classList.add('status-success');
                        idlePill.removeAttribute('title');
                    }
                }
            } catch (_) {
                /* non-fatal */
            }
        } catch (e) {
            // Non-fatal
            console.warn('Version/update check failed', e);
        }
    }
})();
