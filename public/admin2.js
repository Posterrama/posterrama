/* Admin v2 Dashboard (theme-based) */
(function () {
    const $ = (sel, root = document) => root.querySelector(sel);

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

    function showSection(id) {
        const sections = document.querySelectorAll('.app-section');
        sections.forEach(s => s.classList.remove('active'));
        const target = document.getElementById(id);
        if (target) target.classList.add('active');
        // Update header title for basic context switch
        const h1 = document.querySelector('.page-header h1');
        const subtitle = document.querySelector('.page-header p');
        if (h1) {
            if (id === 'section-security') {
                h1.innerHTML = '<i class="fas fa-shield-alt"></i> Security';
                if (subtitle) subtitle.textContent = 'Manage password, 2FA, and API access';
            } else if (id === 'section-operations') {
                h1.innerHTML = '<i class="fas fa-screwdriver-wrench"></i> Operations';
                if (subtitle) subtitle.textContent = 'Run media refresh and manage auto-updates';
            } else {
                h1.innerHTML = '<i class="fas fa-gauge-high"></i> Dashboard';
                if (subtitle) subtitle.textContent = 'Overview of devices, media and system health';
            }
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
                }
            });
        });

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
            const cleanup = () => {
                btnConfirm.replaceWith(btnConfirm.cloneNode(true));
                btnForce.replaceWith(btnForce.cloneNode(true));
            };
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
            await refreshUpdateStatusUI();
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

    // Server Settings + Promobox save
    document.addEventListener('DOMContentLoaded', () => {
        const btnSaveServer = document.getElementById('btn-save-server-settings');
        const btnSavePromo = document.getElementById('btn-save-promobox');
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
                        const protocol = window.location?.protocol === 'https:' ? 'https' : 'http';
                        const port = Number(
                            document.getElementById('siteServer.port')?.value || 4001
                        );
                        const url = `${protocol}://${host}:${port}`;
                        status.innerHTML = `<div class="status-line"><i class="fas fa-globe"></i> Will run at <a class="url-chip" href="${url}" target="_blank" rel="noopener">${url}</a></div>`;
                    } catch {
                        const host = window.location?.hostname || 'localhost';
                        const protocol = window.location?.protocol === 'https:' ? 'https' : 'http';
                        const port = Number(
                            document.getElementById('siteServer.port')?.value || 4001
                        );
                        const url = `${protocol}://${host}:${port}`;
                        status.innerHTML = `<div class="status-line"><i class="fas fa-globe"></i> Will run at <a class="url-chip" href="${url}" target="_blank" rel="noopener">${url}</a></div>`;
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
                    const protocol = window.location?.protocol === 'https:' ? 'https' : 'http';
                    const port = site.port || 4001;
                    const url = `${protocol}://${host}:${port}`;
                    status.innerHTML = `<div class="status-line"><i class="fas fa-globe"></i> Running at <a class="url-chip" href="${url}" target="_blank" rel="noopener">${url}</a></div>`;
                } else {
                    status.textContent = '';
                }
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
