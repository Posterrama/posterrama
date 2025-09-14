/* Admin v2 Dashboard (theme-based) */
(function () {
    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

    function setText(id, val) {
        const el = typeof id === 'string' ? document.getElementById(id) : id;
        if (el) el.textContent = val;
    }

    function formatNumber(n) {
        if (n == null || Number.isNaN(n)) return '—';
        return new Intl.NumberFormat().format(n);
    }

    function clamp(n, min = 0, max = 100) {
        n = Number(n);
        if (Number.isNaN(n)) return 0;
        return Math.max(min, Math.min(max, n));
    }

    function meterGradient(percent, scheme = 'cpu') {
        const p = clamp(percent);
        // Colors: success, warning, error
        const green = 'linear-gradient(90deg,#22c55e,#16a34a)';
        const blue = 'linear-gradient(90deg,#38bdf8,#0284c7)';
        const yellow = 'linear-gradient(90deg,#f59e0b,#d97706)';
        const red = 'linear-gradient(90deg,#ef4444,#dc2626)';
        const base = scheme === 'mem' ? blue : green;
        if (p >= 90) return red;
        if (p >= 70) return yellow;
        return base;
    }

    function setMeter(id, percent, scheme) {
        const el = document.getElementById(id);
        if (!el) return;
        const p = clamp(percent);
        el.style.width = `${p}%`;
        el.style.background = meterGradient(p, scheme);
    }

    async function fetchJSON(url) {
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    }

    async function refreshDevices() {
        try {
            const devices = await fetchJSON('/api/devices');
            const active = devices.filter(
                d => String(d.status || '').toLowerCase() !== 'offline'
            ).length;
            const offline = devices.filter(
                d => String(d.status || '').toLowerCase() === 'offline'
            ).length;
            setText('metric-active-devices', formatNumber(active));
            setText('metric-offline-devices', formatNumber(offline));
            setText('metric-active-trend', offline > 0 ? `${offline} offline` : 'all good');
        } catch (e) {
            console.warn('Failed to load devices', e);
            setText('metric-active-devices', '—');
            setText('metric-offline-devices', '—');
        }
    }

    async function refreshDashboardMetrics() {
        try {
            const dash = await fetchJSON('/api/v1/metrics/dashboard');
            const media = dash?.media?.totalItems ?? dash?.summary?.mediaItems ?? null;
            const sources = dash?.media?.sources ?? dash?.summary?.sources ?? null;
            const warnings = (dash?.alerts || dash?.warnings || []).length;
            setText('metric-media-items', formatNumber(media));
            setText('metric-media-sub', sources ? `from ${formatNumber(sources)} sources` : '');
            setText('metric-warnings', formatNumber(warnings));
            setText('metric-warn-sub', warnings > 0 ? 'needs review' : '');
        } catch (e) {
            console.warn('Failed to load dashboard metrics', e);
            setText('metric-media-items', '—');
            setText('metric-warnings', '—');
        }
    }

    async function refreshPerfDashboard() {
        try {
            // Gather from both system status and metrics endpoints
            const [status, sysMetrics, perfMetrics, cacheMetrics, errorMetrics, realtime] =
                await Promise.all([
                    fetchJSON('/api/admin/status').catch(() => null),
                    fetchJSON('/api/v1/metrics/system').catch(() => null),
                    fetchJSON('/api/v1/metrics/performance').catch(() => null),
                    fetchJSON('/api/v1/metrics/cache').catch(() => null),
                    fetchJSON('/api/v1/metrics/errors').catch(() => null),
                    fetchJSON('/api/v1/metrics/realtime').catch(() => null),
                ]);

            // Status fields
            const appStatus = status?.app?.status ?? 'unknown';
            const dbStatus = status?.database?.status ?? 'unknown';
            const cacheStatus = status?.cache?.status ?? 'unknown';
            setText('perf-app-status', appStatus);
            setText('perf-db-status', dbStatus);
            setText('perf-cache-status', cacheStatus);

            // Sidebar system online indicator removed

            // Resources
            const cpu = sysMetrics?.cpu?.usage ?? sysMetrics?.cpuUsage;
            // System memory from Admin Status (same as legacy Performance Monitor)
            let memPct =
                typeof status?.memory?.percent === 'number' ? status.memory.percent : undefined;
            // Fallback to legacy string percentage: memory.usage (e.g., "42%")
            if (memPct == null && typeof status?.memory?.usage === 'string') {
                const parsed = parseInt(status.memory.usage.replace('%', ''), 10);
                if (!Number.isNaN(parsed)) memPct = parsed;
            }
            const memUsedGB = status?.memory?.usedGB;
            const memTotalGB = status?.memory?.totalGB;
            const memFreeGB = status?.memory?.freeGB;
            const uptimeSec = sysMetrics?.uptime;
            const diskLabel = status?.disk?.available ? `${status.disk.available}` : '—';
            setText('perf-cpu', cpu != null ? `${Math.round(cpu)}%` : '—');
            if (memUsedGB != null && memTotalGB != null) {
                const pctStr = `${Math.round(memPct ?? 0)}%`;
                const freeStr = memFreeGB != null ? `, free ${memFreeGB} GB` : '';
                setText('perf-mem', `${pctStr} (${memUsedGB} GB / ${memTotalGB} GB${freeStr})`);
            } else if (memPct != null) {
                setText('perf-mem', `${Math.round(memPct)}%`);
            } else {
                setText('perf-mem', '—');
            }
            setText(
                'perf-uptime',
                uptimeSec != null ? formatUptime(uptimeSec) : status?.uptime || '—'
            );
            setText('perf-disk', diskLabel);

            // meters
            setMeter('meter-cpu', cpu, 'cpu');
            setMeter('meter-mem', memPct, 'mem');

            // Traffic & Reliability
            const rpm = realtime?.requestsPerMinute;
            const rtAvg =
                perfMetrics?.responseTime?.average ??
                perfMetrics?.responseTime?.avg ??
                perfMetrics?.responseTime ??
                null;
            const errRate = errorMetrics?.errorRate; // already 0-100
            const hitRate = cacheMetrics?.hitRate ?? cacheMetrics?.cacheHitRate; // already 0-100
            setText('perf-rps', rpm != null ? `${formatNumber(Math.round(rpm))} /m` : '—');
            setText('perf-rt', rtAvg != null ? `${Math.round(rtAvg)} ms` : '—');
            setText('perf-error-rate', errRate != null ? `${Number(errRate).toFixed(1)}%` : '—');
            setText('perf-cache-hit', hitRate != null ? `${Math.round(Number(hitRate))}%` : '—');

            // Color status dots
            const statusToClass = s => {
                const v = String(s || '').toLowerCase();
                if (v === 'running' || v === 'connected' || v === 'active' || v === 'success')
                    return 'status-success';
                if (v === 'warning' || v === 'degraded') return 'status-warning';
                if (v === 'error' || v === 'disconnected' || v === 'inactive')
                    return 'status-error';
                return 'status-warning';
            };
            const appDot = document.getElementById('chip-app-dot');
            const dbDot = document.getElementById('chip-db-dot');
            const cacheDot = document.getElementById('chip-cache-dot');
            [appDot, dbDot, cacheDot].forEach((dotEl, idx) => {
                if (!dotEl) return;
                dotEl.classList.remove('status-success', 'status-warning', 'status-error');
                const statusVal = idx === 0 ? appStatus : idx === 1 ? dbStatus : cacheStatus;
                dotEl.classList.add(statusToClass(statusVal));
            });

            // Badge styling for nicer status tiles
            const appBadge = document.getElementById('perf-app-status');
            const dbBadge = document.getElementById('perf-db-status');
            const cacheBadge = document.getElementById('perf-cache-status');
            [
                [appBadge, appStatus],
                [dbBadge, dbStatus],
                [cacheBadge, cacheStatus],
            ].forEach(([badgeEl, statusVal]) => {
                if (!badgeEl) return;
                badgeEl.classList.remove('status-success', 'status-warning', 'status-error');
                badgeEl.classList.add(statusToClass(statusVal));
            });
        } catch (e) {
            console.warn('Failed to load performance dashboard', e);
        }
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

    async function refreshCacheStatsV2() {
        try {
            const res = await fetch('/api/admin/cache-stats', { credentials: 'include' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            updateCacheStatsDisplayV2(data);
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
        // Read server-side cache config if exposed; fallback to known default 2GB
        const maxSizeGB = (data.cacheConfig && data.cacheConfig.maxSizeGB) || 2;
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
        // Ensure spinner spans exist
        const ensureSpinner = btn => {
            if (!btn) return;
            if (!btn.querySelector('.spinner')) {
                const sp = document.createElement('span');
                sp.className = 'spinner';
                btn.insertBefore(sp, btn.firstChild);
            }
        };
        ensureSpinner(cleanupBtn);
        ensureSpinner(clearBtn);
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
                clearBtn.querySelector('span') &&
                    (clearBtn.querySelector('span').textContent = 'Click again to confirm');
                setTimeout(() => {
                    clearBtn.removeAttribute('data-confirm');
                    const span = clearBtn.querySelector('span');
                    if (span) span.textContent = 'Clear Cache';
                }, 2000);
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
                // Ensure button label returns to default state after action
                const span = clearBtn.querySelector('span');
                if (span) span.textContent = 'Clear Cache';
                clearBtn.removeAttribute('data-confirm');
                refreshCacheStatsV2();
            }
        });
    }
    function formatUptime(sec) {
        const d = Math.floor(sec / 86400);
        const h = Math.floor((sec % 86400) / 3600);
        const m = Math.floor((sec % 3600) / 60);
        if (d) return `${d}d ${h}h`;
        if (h) return `${h}h ${m}m`;
        return `${m}m`;
    }

    function wireEvents() {
        const perfRefreshBtn = $('#btn-perf-refresh');
        // Ensure a spinner on the refresh icon button as well
        if (perfRefreshBtn && !perfRefreshBtn.querySelector('.spinner')) {
            const sp = document.createElement('span');
            sp.className = 'spinner';
            perfRefreshBtn.appendChild(sp);
        }
        perfRefreshBtn?.addEventListener('click', () => {
            // Refresh the entire System Performance section: status/resources/traffic + cache
            perfRefreshBtn.classList.add('btn-loading');
            refreshPerfDashboard();
            refreshCacheStatsV2().finally(() => {
                setTimeout(() => perfRefreshBtn.classList.remove('btn-loading'), 400);
            });
        });
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
        const dropdown = document.getElementById('settings-dropdown');
        function closeMenu() {
            if (!settingsMenu) return;
            settingsBtn?.setAttribute('aria-expanded', 'false');
            settingsMenu?.setAttribute('aria-hidden', 'true');
            dropdown?.classList.remove('open');
        }
        settingsBtn?.addEventListener('click', e => {
            e.stopPropagation();
            if (!settingsMenu) return;
            const willOpen = !dropdown?.classList.contains('open');
            if (willOpen) dropdown?.classList.add('open');
            else dropdown?.classList.remove('open');
            settingsBtn.setAttribute('aria-expanded', String(willOpen));
            settingsMenu?.setAttribute('aria-hidden', String(!willOpen));
        });
        document.addEventListener('click', e => {
            if (!dropdown || !settingsMenu) return;
            if (!dropdown.contains(e.target)) closeMenu();
        });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') closeMenu();
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
                const res = await fetch('/api/admin/restart-app', {
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
    }

    // exportMetrics removed with header Export button

    async function refreshAll() {
        await Promise.all([
            refreshDevices(),
            refreshDashboardMetrics(),
            refreshPerfDashboard(),
            refreshVersionAndUpdate(),
        ]);
        await refreshCacheStatsV2();
    }

    // Init
    document.addEventListener('DOMContentLoaded', () => {
        wireEvents();
        wireCacheActions();
        refreshAll();
    });

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
        } catch (e) {
            // Non-fatal
            console.warn('Version/update check failed', e);
        }
    }
})();
