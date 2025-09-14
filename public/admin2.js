/* Admin v2 Dashboard (theme-based) */
(function () {
    const $ = (sel, root = document) => root.querySelector(sel);

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
        // Try a child .meter-fill bar first
        const fill = el.querySelector?.('.meter-fill');
        if (fill) {
            fill.style.width = `${v}%`;
            fill.setAttribute('aria-valuenow', String(v));
        } else {
            // Fallback: set CSS var or width directly on the element
            el.style.setProperty('--value', v);
            el.style.width = el.classList?.contains('meter') ? `${v}%` : el.style.width;
            el.setAttribute?.('aria-valuenow', String(v));
        }
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
            const isLive = d => {
                try {
                    const raw = String(d.status || '').toLowerCase();
                    if (d?.currentState?.poweredOff) return false;
                    if (d?.wsConnected) return true;
                    return raw === 'online' || raw === 'live';
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
        // Populate media totals and warnings for the top dashboard cards
        try {
            const data = await fetchJSON('/api/v1/metrics/dashboard').catch(() => null);
            if (data) {
                const totalMedia =
                    Number(data?.media?.libraryTotals?.total) ||
                    Number(data?.media?.playlistItems) ||
                    0;
                setText('metric-media-items', formatNumber(totalMedia));
                const warns = Array.isArray(data?.alerts) ? data.alerts.length : 0;
                setText('metric-warnings', formatNumber(warns));
                const warnSub = document.getElementById('metric-warn-sub');
                if (warnSub) warnSub.textContent = warns > 0 ? 'check system' : 'no alerts';
            }
        } catch (_) {
            // non-fatal
        }
        // Also refresh devices counts shown on this dashboard row
        await refreshDevices();
    }

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
                    badge.classList.remove('status-success', 'status-warning', 'status-error');
                    badge.classList.add(`status-${cls}`);
                    badge.textContent = String(textVal || '').toLowerCase();
                }
            };
            setChip('chip-app-dot', 'perf-app-status', appCls, app);
            setChip('chip-db-dot', 'perf-db-status', dbCls, db);
            setChip('chip-cache-dot', 'perf-cache-status', cacheCls, cache);

            // Uptime and memory percent (fallback from status)
            const uptimeTxt = String(status?.uptime || '—');
            setText('perf-uptime', uptimeTxt);
            const memPct = Number(status?.memory?.percent);
            if (Number.isFinite(memPct)) {
                setText(
                    'perf-mem',
                    `${memPct}% (${status?.memory?.usedGB || '—'} GB / ${status?.memory?.totalGB || '—'} GB)`
                );
                setMeter('meter-mem', memPct, 'mem');
            }
        } catch (_) {
            // ignore
        }

        // Detailed performance (CPU, Disk) and show meters
        try {
            const perf = await fetchJSON('/api/admin/performance');
            const cpu = Math.max(0, Math.min(100, Number(perf?.cpu?.usage || 0)));
            const mem = Math.max(0, Math.min(100, Number(perf?.memory?.usage || 0)));
            const diskPct = Math.max(0, Math.min(100, Number(perf?.disk?.usage || 0)));
            setText('perf-cpu', `${cpu}%`);
            setMeter('meter-cpu', cpu, 'cpu');
            setText(
                'perf-mem',
                `${mem}% (${perf?.memory?.used || '—'} / ${perf?.memory?.total || '—'})`
            );
            setMeter('meter-mem', mem, 'mem');
            setText(
                'perf-disk',
                `${diskPct}% (${perf?.disk?.used || '—'} / ${perf?.disk?.total || '—'})`
            );
            setText('perf-uptime', perf?.uptime || '—');
        } catch (_) {
            // ignore
        }

        // Traffic and reliability KPIs
        try {
            const [rt, dash, cache] = await Promise.all([
                fetchJSON('/api/v1/metrics/realtime').catch(() => null),
                fetchJSON('/api/v1/metrics/dashboard').catch(() => null),
                fetchJSON('/api/v1/metrics/cache').catch(() => null),
            ]);
            const rpm = Number(rt?.requestsPerMinute || 0);
            setText('perf-rps', rpm ? `${rpm}/min` : '0/min');
            const avgRt = Number(dash?.summary?.averageResponseTime || 0);
            setText('perf-rt', `${Math.round(avgRt)} ms`);
            const errRate = Number(dash?.summary?.errorRate || 0);
            setText('perf-error-rate', `${errRate.toFixed(2)}%`);
            const hitRate = Number(cache?.hitRate || 0);
            setText('perf-cache-hit', `${hitRate.toFixed(1)}%`);
        } catch (_) {
            // ignore
        }
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
        // (moved) TMDB custom dropdown wiring lives near TVDB wiring after iconFor()
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
    // format uptime helper (not used everywhere but kept for parity/UI)
    // eslint-disable-next-line no-unused-vars
    function formatUptime(sec) {
        const d = Math.floor(sec / 86400);
        const h = Math.floor((sec % 86400) / 3600);
        const m = Math.floor((sec % 3600) / 60);
        if (d) return `${d}d ${h}h`;
        if (h) return `${h}h ${m}m`;
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
        const h1 = document.querySelector('.page-header h1');
        const subtitle = document.querySelector('.page-header p');
        if (h1) {
            if (id === 'section-security') {
                h1.innerHTML = '<i class="fas fa-shield-alt"></i> Security';
                if (subtitle) subtitle.textContent = 'Manage password, 2FA, and API access';
            } else if (id === 'section-media-sources') {
                h1.innerHTML = '<i class="fas fa-server"></i> Media Sources';
                if (subtitle) subtitle.textContent = 'Configure Plex, Jellyfin, TMDB, and TVDB';
            } else if (id === 'section-operations') {
                h1.innerHTML = '<i class="fas fa-screwdriver-wrench"></i> Operations';
                if (subtitle) subtitle.textContent = 'Run media refresh and manage auto-updates';
            } else {
                h1.innerHTML = '<i class="fas fa-gauge-high"></i> Dashboard';
                if (subtitle) subtitle.textContent = 'Overview of devices, media and system health';
            }
        }
        dbg('showSection() applied', { activeId: id, sections: sections.length });
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

    async function refreshSecurity() {
        try {
            // 2FA status piggybacks on /api/admin/config
            const cfg = await fetchJSON('/api/admin/config');
            const is2FA = !!cfg?.security?.is2FAEnabled;
            const txt = document.getElementById('sec-2fa-status');
            const btnEnable = document.getElementById('btn-2fa-enable');
            const btnDisable = document.getElementById('btn-2fa-disable');
            if (txt)
                txt.textContent = is2FA
                    ? 'Two-Factor Authentication is enabled'
                    : 'Two-Factor Authentication is disabled';
            if (btnEnable) {
                btnEnable.disabled = !!is2FA;
                btnEnable.classList.remove('btn-primary', 'btn-error', 'btn-secondary');
                // Keep enable button as secondary when available, muted when disabled
                btnEnable.classList.add('btn-secondary');
            }
            if (btnDisable) {
                const active = !!is2FA;
                btnDisable.disabled = !active;
                btnDisable.classList.remove('btn-primary', 'btn-secondary', 'btn-error');
                btnDisable.classList.add(active ? 'btn-error' : 'btn-secondary');
            }

            // API key status
            const statusRes = await fetch('/api/admin/api-key/status', { credentials: 'include' });
            const status = statusRes.ok ? await statusRes.json() : { hasKey: false };
            const hasKey = !!status?.hasKey;
            const statusText = document.getElementById('api-key-status-text');
            const display = document.getElementById('api-key-display');
            const revokeBtn = document.getElementById('revoke-api-key-button');
            if (statusText) statusText.textContent = hasKey ? 'Present' : 'None';
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
            console.warn('Security refresh failed', e);
        }
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
                item.classList.add('active');
                if (nav === 'security') {
                    showSection('section-security');
                    refreshSecurity();
                } else if (nav === 'dashboard') {
                    showSection('section-dashboard');
                } else if (nav === 'operations') {
                    showSection('section-operations');
                    // ensure latest status/backups when entering
                    refreshUpdateStatusUI();
                    refreshOperationsPanels();
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
                el.scrollIntoView({ behavior: 'auto', block: 'start' });
                // Show loading overlay while we ensure config is populated
                el.classList.add('is-loading');
            } else {
                dbg('panel not found', { panelId });
            }
            // Ensure inputs are populated, then clear loading state only for the visible panel
            Promise.resolve(window.admin2?.loadMediaSources?.())
                .catch(() => {})
                .finally(() => {
                    const active = document.getElementById(panelId);
                    active?.classList.remove('is-loading');
                    dbg('showSourcePanel() applied', { panelId, visible: !active?.hidden });
                });
        }

        mediaGroup?.querySelectorAll('.nav-subitem').forEach((sub, idx) => {
            sub.addEventListener('click', e => {
                e.preventDefault();
                document
                    .querySelectorAll('.sidebar-nav .nav-item')
                    .forEach(n => n.classList.remove('active'));
                // Mark group header and the clicked subitem as active
                toggleLink?.classList.add('active');
                mediaGroup
                    ?.querySelectorAll('.nav-subitem')
                    .forEach(s => s.classList.remove('active'));
                sub.classList.add('active');
                const panelIds = ['panel-plex', 'panel-jellyfin', 'panel-tmdb', 'panel-tvdb'];
                const titles = ['Plex', 'Jellyfin', 'TMDB', 'TVDB'];
                const id = panelIds[idx] || 'panel-plex';
                const title = titles[idx] || 'Media Sources';
                dbg('submenu click', { idx, id, title });
                // Update URL hash for direct linking and routing
                const hashes = ['#plex', '#jellyfin', '#tmdb', '#tvdb'];
                const h = hashes[idx] || '#plex';
                if (location.hash !== h) location.hash = h;
                // Just update the URL and let the hash router display the panel; avoid extra reloads
                // The initial load happens on DOMContentLoaded and after saves.
            });
        });

        // Lightweight hash router so /admin2.html#plex always opens Plex panel
        // Debounced router to avoid rapid flicker when switching fast
        let routeTimer = null;
        function routeByHash() {
            if (routeTimer) {
                clearTimeout(routeTimer);
                routeTimer = null;
            }
            routeTimer = setTimeout(() => {
                routeTimer = null;
                const h = (location.hash || '').toLowerCase();
                if (h === '#plex' || h === '#media-sources/plex') {
                    showSourcePanel('panel-plex', 'Plex');
                    return;
                }
                if (h === '#jellyfin') {
                    showSourcePanel('panel-jellyfin', 'Jellyfin');
                    return;
                }
                if (h === '#tmdb') {
                    showSourcePanel('panel-tmdb', 'TMDB');
                    return;
                }
                if (h === '#tvdb') {
                    showSourcePanel('panel-tvdb', 'TVDB');
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
        // Initial route on load
        routeByHash();

        // Security panel auto-refresh handled on nav; no manual refresh button

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
        ensureSpinner(btn2faVerify);
        btn2faVerify?.addEventListener('click', async () => {
            const input = document.getElementById('input-2fa-token');
            const token = (input?.value || '').trim();
            if (!token)
                return window.notify?.toast({
                    type: 'warning',
                    title: 'Missing code',
                    message: 'Enter the 6-digit code from your app',
                    duration: 3500,
                });
            try {
                btn2faVerify.classList.add('btn-loading');
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
                    title: '2FA enabled',
                    message: 'Two-Factor Authentication is now active.',
                    duration: 3500,
                });
                closeModal('modal-2fa');
                refreshSecurity();
            } catch (e) {
                window.notify?.toast({
                    type: 'error',
                    title: 'Verification failed',
                    message: e?.message || 'Invalid code',
                    duration: 5000,
                });
            } finally {
                btn2faVerify?.classList.remove('btn-loading');
            }
        });

        // 2FA disable flow
        btn2faDisable?.addEventListener('click', () => openModal('modal-2fa-disable'));
        const btn2faDisableConfirm = document.getElementById('btn-2fa-disable-confirm');
        ensureSpinner(btn2faDisableConfirm);
        btn2faDisableConfirm?.addEventListener('click', async () => {
            const pw = document.getElementById('input-2fa-disable-password');
            const password = pw?.value || '';
            if (!password)
                return window.notify?.toast({
                    type: 'warning',
                    title: 'Password required',
                    message: 'Enter current password to disable 2FA',
                    duration: 3500,
                });
            try {
                btn2faDisableConfirm.classList.add('btn-loading');
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
                    title: '2FA disabled',
                    message: 'Two-Factor Authentication has been disabled.',
                    duration: 3500,
                });
                closeModal('modal-2fa-disable');
                refreshSecurity();
            } catch (e) {
                window.notify?.toast({
                    type: 'error',
                    title: 'Disable failed',
                    message: e?.message || 'Unable to disable 2FA',
                    duration: 5000,
                });
            } finally {
                btn2faDisableConfirm.classList.remove('btn-loading');
            }
        });

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
            input.type = input.type === 'password' ? 'text' : 'password';
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
            const barEl = document.getElementById('update-progress-bar');
            const msgEl = document.getElementById('update-message');
            const isUpdating = !!status?.isUpdating;
            if (isUpdating) {
                idle.style.display = 'none';
                prog.style.display = '';
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
        const btnSaveServer = document.getElementById('btn-save-server-settings');
        const btnSavePromo = document.getElementById('btn-save-promobox');
        const btnSaveOps = document.getElementById('btn-save-operations');
        const portInput = document.getElementById('SERVER_PORT');
        // Helper to fetch config, patch minimal keys, and POST back
        async function saveConfigPatch(patchConfig, patchEnv) {
            const cfgRes = await fetch('/api/admin/config', { credentials: 'include' });
            const cfg = cfgRes.ok ? await cfgRes.json() : {};
            const body = {
                config: { ...(cfg?.config || cfg || {}), ...(patchConfig || {}) },
                env: { ...(cfg?.env || {}), ...(patchEnv || {}) },
            };
            const r = await fetch('/api/admin/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(body),
            });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j?.error || j?.message || 'Save failed');
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

        // Generic theme-demo multiselect (chips + dropdown) for backing <select multiple>
        function initMsForSelect(idBase, selectId) {
            const sel = document.getElementById(selectId);
            const root = document.getElementById(`${idBase}`);
            if (!sel || !root) return;
            if (root.dataset.msWired === 'true') return;
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

        async function loadMediaSources() {
            const r = await fetch('/api/admin/config', { credentials: 'include' });
            const j = r.ok ? await r.json() : {};
            const env = j?.env || {};
            const cfg = j?.config || j || {};
            dbg('loadMediaSources()', { hasConfig: !!cfg, hasEnv: !!env });
            // Plex/Jellyfin server entries
            const plex = (cfg.mediaServers || []).find(s => s.type === 'plex') || {};
            const jf = (cfg.mediaServers || []).find(s => s.type === 'jellyfin') || {};
            // Plex
            const plexEnabled = !!plex.enabled;
            const plexHostVar = plex.hostnameEnvVar || 'PLEX_HOSTNAME';
            const plexPortVar = plex.portEnvVar || 'PLEX_PORT';
            const plexTokenVar = plex.tokenEnvVar || 'PLEX_TOKEN';
            getInput('plex.enabled') && (getInput('plex.enabled').checked = plexEnabled);
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
            if (getInput('plex.ratingFilter'))
                getInput('plex.ratingFilter').value = (plex.ratingFilter || []).join(', ');
            // Quality filter (single-select string like "SD", "720p", "1080p", "4K")
            if (getInput('plex.qualityFilter'))
                getInput('plex.qualityFilter').value = plex.qualityFilter || '';
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
            // Jellyfin
            const jfEnabled = !!jf.enabled;
            const jfHostVar = jf.hostnameEnvVar || 'JELLYFIN_HOSTNAME';
            const jfPortVar = jf.portEnvVar || 'JELLYFIN_PORT';
            const jfKeyVar = jf.tokenEnvVar || 'JELLYFIN_API_KEY';
            if (getInput('jf.enabled')) getInput('jf.enabled').checked = jfEnabled;
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
            if (getInput('jf.yearFilter')) {
                const v = jf.yearFilter;
                getInput('jf.yearFilter').value = v == null ? '' : String(v);
            }
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
            // TMDB
            const tmdb = cfg.tmdbSource || {};
            if (getInput('tmdb.enabled')) getInput('tmdb.enabled').checked = !!tmdb.enabled;
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
            // Load TMDB genres with selection from config
            try {
                await loadTMDBGenres(tmdb.genreFilter || '');
            } catch (_) {
                // ignore (initial genre load is optional)
            }
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
        }
        // Expose for reuse
        window.admin2 = window.admin2 || {};
        window.admin2.loadMediaSources = loadMediaSources;

        // Fetch libraries
        async function fetchPlexLibraries() {
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
                initMsForSelect('plex-ms-movies', 'plex.movies');
                initMsForSelect('plex-ms-shows', 'plex.shows');
                window.notify?.toast({
                    type: 'success',
                    title: 'Plex',
                    message: 'Libraries loaded',
                    duration: 2200,
                });
            } catch (e) {
                window.notify?.toast({
                    type: 'error',
                    title: 'Plex',
                    message: e?.message || 'Failed to fetch libraries',
                    duration: 4200,
                });
            }
        }

        // ------- Plex Genre Filter (chips with hidden input) -------
        function setPlexGenreFilterHidden(val) {
            const hidden = document.getElementById('plex.genreFilter-hidden');
            if (hidden) hidden.value = val || '';
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
            // Sort by count desc then name
            const list = (genres || []).slice().sort((a, b) => {
                const ac = Number(a.count || 0);
                const bc = Number(b.count || 0);
                if (bc !== ac) return bc - ac;
                return String(a.name || a.value || '').localeCompare(
                    String(b.name || b.value || '')
                );
            });
            list.forEach(g => {
                const name = g.name || g.value || String(g);
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
            if (!chipsRoot || !optsEl || !root || !control || !search) return;
            chipsRoot.innerHTML = '<div class="subtle">Loading genres…</div>';
            try {
                // Prefer test endpoint if user provided connection params
                const hostname = getInput('plex.hostname')?.value;
                const port = getInput('plex.port')?.value;
                const token = getInput('plex.token')?.value;
                let res;
                if (hostname && port) {
                    res = await fetch('/api/admin/plex-genres-with-counts-test', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ hostname, port, token: token || undefined }),
                    });
                } else {
                    res = await fetch('/api/admin/plex-genres-with-counts', {
                        credentials: 'include',
                    });
                }
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json().catch(() => ({}));
                const genres = Array.isArray(data?.genres) ? data.genres : [];
                // Build options and chips using theme-demo component
                const names = genres
                    .slice()
                    .map(g => g.name || g.value || String(g))
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
                const openMenu = open => {
                    root.classList.toggle('ms-open', !!open);
                    control.setAttribute('aria-expanded', open ? 'true' : 'false');
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
                        if (!root.contains(e.target)) openMenu(false);
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
        async function fetchJellyfinLibraries() {
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
                initMsForSelect('jf-ms-movies', 'jf.movies');
                initMsForSelect('jf-ms-shows', 'jf.shows');
                window.notify?.toast({
                    type: 'success',
                    title: 'Jellyfin',
                    message: 'Libraries loaded',
                    duration: 2200,
                });
            } catch (e) {
                window.notify?.toast({
                    type: 'error',
                    title: 'Jellyfin',
                    message: e?.message || 'Failed to fetch libraries',
                    duration: 4200,
                });
            }
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
                // On success, offer to fetch libraries
                fetchPlexLibraries();
                // And refresh available genres list using the same connection context
                const currentGenres = getPlexGenreFilterHidden();
                loadPlexGenres(currentGenres).catch(() => {});
            } catch (e) {
                window.notify?.toast({
                    type: 'error',
                    title: 'Plex',
                    message: e?.message || 'Connection failed',
                    duration: 4200,
                });
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
                if (!hostname || !port) throw new Error('Hostname and port are required');
                const res = await fetch('/api/admin/test-jellyfin', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ hostname, port, apiKey: apiKey || undefined }),
                });
                const j = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(j?.error || 'Connection failed');
                window.notify?.toast({
                    type: 'success',
                    title: 'Jellyfin',
                    message: 'Connection successful',
                    duration: 2200,
                });
                fetchJellyfinLibraries();
            } catch (e) {
                window.notify?.toast({
                    type: 'error',
                    title: 'Jellyfin',
                    message: e?.message || 'Connection failed',
                    duration: 4200,
                });
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
                const cfgRes = await fetch('/api/admin/config', { credentials: 'include' });
                const base = cfgRes.ok ? await cfgRes.json() : {};
                const currentCfg = base?.config || base || {};
                const currentEnv = base?.env || {};
                const servers = Array.isArray(currentCfg.mediaServers)
                    ? [...currentCfg.mediaServers]
                    : [];
                const plexIdx = servers.findIndex(s => s.type === 'plex');
                const plex = plexIdx >= 0 ? { ...servers[plexIdx] } : { type: 'plex' };
                // Update Plex fields
                plex.enabled = !!getInput('plex.enabled')?.checked;
                plex.recentlyAddedOnly = !!getInput('plex.recentOnly')?.checked;
                plex.recentlyAddedDays = toInt(getInput('plex.recentDays')?.value) ?? 30;
                plex.ratingFilter = parseCsvList(getInput('plex.ratingFilter')?.value);
                plex.qualityFilter = (getInput('plex.qualityFilter')?.value || '').trim();
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
                const envPatch = { ...currentEnv };
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
                loadMediaSources()
                    .then(() => {
                        const r = getPlexGenreFilterHidden();
                        loadPlexGenres(r).catch(() => {});
                    })
                    .catch(() => {});
            }
        }

        async function saveJellyfin() {
            const btn = document.getElementById('btn-save-jellyfin');
            btn?.classList.add('btn-loading');
            try {
                const cfgRes = await fetch('/api/admin/config', { credentials: 'include' });
                const base = cfgRes.ok ? await cfgRes.json() : {};
                const currentCfg = base?.config || base || {};
                const currentEnv = base?.env || {};
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
                jf.movieLibraryNames = getMultiSelectValues('jf.movies');
                jf.showLibraryNames = getMultiSelectValues('jf.shows');
                jf.hostnameEnvVar = jf.hostnameEnvVar || 'JELLYFIN_HOSTNAME';
                jf.portEnvVar = jf.portEnvVar || 'JELLYFIN_PORT';
                jf.tokenEnvVar = jf.tokenEnvVar || 'JELLYFIN_API_KEY';
                if (jfIdx >= 0) servers[jfIdx] = jf;
                else servers.push(jf);
                const envPatch = { ...currentEnv };
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
                loadMediaSources().catch(() => {});
            }
        }

        async function saveTMDB() {
            const btn = document.getElementById('btn-save-tmdb');
            btn?.classList.add('btn-loading');
            try {
                const cfgRes = await fetch('/api/admin/config', { credentials: 'include' });
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
                loadMediaSources().catch(() => {});
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
                const r = await fetch('/api/admin/tmdb-genres', { credentials: 'include' });
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

        async function saveTVDB() {
            const btn = document.getElementById('btn-save-tvdb');
            btn?.classList.add('btn-loading');
            try {
                const cfgRes = await fetch('/api/admin/config', { credentials: 'include' });
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
        document
            .getElementById('btn-plex-libraries')
            ?.addEventListener('click', fetchPlexLibraries);
        document
            .getElementById('btn-jf-libraries')
            ?.addEventListener('click', fetchJellyfinLibraries);
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
        // Reload genres when user clicks Fetch Libraries (often indicates valid connection)
        document.getElementById('btn-plex-libraries')?.addEventListener('click', () => {
            const current = getPlexGenreFilterHidden();
            loadPlexGenres(current).catch(() => {});
        });

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
        // Expose for later use after async loads
        window.updateOpsSaveButtonLabel = updateOpsSaveButtonLabel;
        // Wire live updates on port input
        if (portInput) {
            ['input', 'change'].forEach(evt =>
                portInput.addEventListener(evt, updateOpsSaveButtonLabel)
            );
        }

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
                    { serverPort: serverPort, siteServer: { enabled, port: portVal } },
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
            if (portGroup) portGroup.style.display = show ? 'block' : 'none';
            if (status) {
                status.style.display = show ? 'block' : 'none';
                if (show) {
                    try {
                        // Fetch current server info to get an IP if exposed; otherwise, use the current host
                        const cfgRes = await fetch('/api/admin/config', { credentials: 'include' });
                        const cfg = cfgRes.ok ? await cfg.json() : {};
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
        });
    });

    async function refreshOperationsPanels() {
        try {
            const r = await fetch('/api/admin/config', { credentials: 'include' });
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
            // Promobox
            const site = cfg.siteServer || {};
            const enabledEl = document.getElementById('siteServer.enabled');
            const portEl = document.getElementById('siteServer.port');
            const portGroup = document.getElementById('siteServerPortGroup');
            const status = document.getElementById('siteServerStatus');
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
        } catch (e) {
            // Non-fatal
            console.warn('Version/update check failed', e);
        }
    }
})();
