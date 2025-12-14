let plexUsersCache = null;
let plexUsersCacheAt = 0;

function safeString(val) {
    return val == null ? '' : String(val);
}

function clone(obj) {
    try {
        return JSON.parse(JSON.stringify(obj || {}));
    } catch (_) {
        return {};
    }
}

function cleanupEmpty(obj) {
    if (!obj || typeof obj !== 'object') return;
    for (const key of Object.keys(obj)) {
        const v = obj[key];
        if (v && typeof v === 'object' && !Array.isArray(v)) {
            cleanupEmpty(v);
            if (Object.keys(v).length === 0) delete obj[key];
        }
    }
}

function sameOrNull(values) {
    const uniq = Array.from(new Set(values.map(v => safeString(v))));
    if (uniq.length === 1) return uniq[0];
    return null;
}

export function createOverrideModal({
    fetchJSON,
    sendCommand,
    showOverlay,
    escapeHtml,
    notify,
    loadDevices,
}) {
    async function loadPlexUsers() {
        const TTL = 5 * 60 * 1000;
        const now = Date.now();
        if (plexUsersCache && now - plexUsersCacheAt < TTL) return plexUsersCache;

        const res = await fetchJSON('/api/plex/users');
        if (res && res.success === false) {
            toast({
                type: 'warning',
                message: safeString(res.error || 'Plex users unavailable.'),
            });
        }
        const users = Array.isArray(res?.users) ? res.users : [];
        plexUsersCache = users;
        plexUsersCacheAt = now;
        return users;
    }

    function toast(args) {
        try {
            notify?.toast?.(args);
        } catch (_) {
            /* ignore */
        }
    }

    async function openOverrideFor(ids) {
        if (!Array.isArray(ids) || !ids.length) return;

        const overlay = document.getElementById('modal-override');
        if (overlay) showOverlay?.(overlay, 'modal-override');

        const applyBtn = document.getElementById('btn-override-apply');
        const statusEl = document.getElementById('override-override-status');

        const sessionModeEl = document.getElementById('override-session-mode');
        const plexUserRow = document.getElementById('override-plex-user-row');
        const plexUserEl = document.getElementById('override-plex-user');
        const sourcePrefEl = document.getElementById('override-nowplaying-source');

        const pinQueryEl = document.getElementById('override-pin-query');
        const pinSearchBtn = document.getElementById('override-pin-search-btn');
        const pinResultsEl = document.getElementById('override-pin-results');
        const pinCurrentTextEl = document.getElementById('override-pin-current-text');
        const pinClearBtn = document.getElementById('override-pin-clear-btn');

        function setStatus(kind, msg) {
            if (!statusEl) return;
            const icon =
                kind === 'error'
                    ? 'fa-exclamation-triangle'
                    : kind === 'success'
                      ? 'fa-check-circle'
                      : 'fa-info-circle';
            statusEl.className = `override-status ${kind || 'neutral'}`;
            statusEl.innerHTML = `<i class="fas ${icon} icon"></i>${escapeHtml(safeString(msg))}`;
        }

        const originals = {}; // id -> settingsOverride
        const lockedUsers = [];
        const sourcePrefs = [];
        const pinnedKeys = [];
        let selectedPinnedKey = '';

        function setPinnedKey(key, fromUserAction = false) {
            selectedPinnedKey = key ? safeString(key) : '';
            if (pinCurrentTextEl) pinCurrentTextEl.textContent = selectedPinnedKey || '(none)';
            if (fromUserAction) {
                setStatus(
                    'neutral',
                    selectedPinnedKey ? 'Pinned selection updated.' : 'Pinned selection cleared.'
                );
            }
        }

        function renderPinResults(results) {
            if (!pinResultsEl) return;
            const list = Array.isArray(results) ? results : [];
            if (!list.length) {
                pinResultsEl.innerHTML =
                    '<div class="hint" style="color: var(--color-text-muted);">No results.</div>';
                return;
            }
            pinResultsEl.innerHTML = list
                .map(r => {
                    const key = safeString(r?.key);
                    const title = safeString(r?.title);
                    const year = r?.year ? ` (${escapeHtml(safeString(r.year))})` : '';
                    const type = r?.type ? escapeHtml(safeString(r.type)) : '';
                    const source = r?.source ? escapeHtml(safeString(r.source)) : '';
                    const posterUrl = r?.posterUrl ? safeString(r.posterUrl) : '';
                    const active = selectedPinnedKey && key === selectedPinnedKey;
                    return `
                        <button type="button" class="pin-result ${active ? 'active' : ''}" data-pin-key="${escapeHtml(
                            key
                        )}" style="display:flex; gap:10px; align-items:center; text-align:left; padding:10px; border-radius:10px; border:1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.02);">
                            <div style="width:44px; height:66px; border-radius:8px; overflow:hidden; background: rgba(255,255,255,.06); flex: 0 0 auto;">
                                ${
                                    posterUrl
                                        ? `<img src="${escapeHtml(
                                              posterUrl
                                          )}" alt="" style="width:100%; height:100%; object-fit:cover; display:block;" />`
                                        : ''
                                }
                            </div>
                            <div style="display:flex; flex-direction:column; gap:2px; flex:1; min-width:0;">
                                <div style="font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(
                                    title
                                )}${year}</div>
                                <div class="hint" style="font-size:.82rem; color: var(--color-text-muted);">
                                    ${type}${type && source ? ' • ' : ''}${source}
                                </div>
                            </div>
                            <div style="flex: 0 0 auto; color: var(--color-teal);">
                                <i class="fas fa-thumbtack"></i>
                            </div>
                        </button>`;
                })
                .join('');
        }

        async function hydrateFromDevices() {
            setStatus('neutral', 'Loading current overrides…');
            const deviceResponses = await Promise.all(
                ids.map(id => fetchJSON(`/api/devices/${encodeURIComponent(id)}`).catch(() => null))
            );

            deviceResponses.forEach((dev, idx) => {
                const id = ids[idx];
                const ov =
                    dev?.settingsOverride && typeof dev.settingsOverride === 'object'
                        ? dev.settingsOverride
                        : {};
                originals[id] = clone(ov);

                const pinned = ov?.cinema?.pinnedMediaKey || '';
                pinnedKeys.push(pinned ? safeString(pinned) : '');

                const srcPref = ov?.cinema?.nowPlaying?.sourcePreference || 'auto';
                sourcePrefs.push(srcPref ? safeString(srcPref) : 'auto');

                const ovUser = ov?.cinema?.nowPlaying?.filterUser || '';
                const devUser = dev?.plexUsername || '';
                lockedUsers.push(safeString(ovUser || devUser || ''));
            });

            const lockedUserSame = sameOrNull(lockedUsers);
            const srcPrefSame = sameOrNull(sourcePrefs);
            const pinnedSame = sameOrNull(pinnedKeys);

            if (sessionModeEl) sessionModeEl.value = lockedUserSame ? 'locked' : 'multiple';
            if (plexUserRow)
                plexUserRow.style.display = sessionModeEl?.value === 'locked' ? 'block' : 'none';

            if (sourcePrefEl) sourcePrefEl.value = srcPrefSame || 'auto';
            setPinnedKey(pinnedSame || '', false);

            // Users
            if (plexUserEl) {
                try {
                    const users = await loadPlexUsers();
                    const names = users
                        .map(u => safeString(u?.title || u?.username))
                        .map(s => s.trim())
                        .filter(Boolean);

                    plexUserEl.innerHTML =
                        '<option value="">— Select user —</option>' +
                        names
                            .map(n => {
                                const sel =
                                    lockedUserSame && n === lockedUserSame ? ' selected' : '';
                                return `<option value="${escapeHtml(n)}"${sel}>${escapeHtml(n)}</option>`;
                            })
                            .join('');
                } catch (e) {
                    plexUserEl.innerHTML = '<option value="">Unavailable</option>';
                    setStatus(
                        'error',
                        `Could not load Plex users: ${e?.message || 'request failed'}`
                    );
                }
            }

            setStatus('neutral', 'Ready. Apply triggers an instant reload.');
        }

        // Event binding
        if (sessionModeEl) {
            const next = sessionModeEl.cloneNode(true);
            sessionModeEl.parentNode.replaceChild(next, sessionModeEl);
            next.addEventListener('change', () => {
                if (plexUserRow)
                    plexUserRow.style.display = next.value === 'locked' ? 'block' : 'none';
            });
        }

        if (pinClearBtn) {
            const next = pinClearBtn.cloneNode(true);
            pinClearBtn.parentNode.replaceChild(next, pinClearBtn);
            next.addEventListener('click', () => {
                setPinnedKey('', true);
                if (pinResultsEl) {
                    pinResultsEl
                        .querySelectorAll('[data-pin-key]')
                        .forEach(el => el.classList.remove('active'));
                }
            });
        }

        if (pinSearchBtn) {
            const next = pinSearchBtn.cloneNode(true);
            pinSearchBtn.parentNode.replaceChild(next, pinSearchBtn);
            next.addEventListener('click', async () => {
                const q = safeString(document.getElementById('override-pin-query')?.value).trim();
                if (!q) {
                    setStatus('neutral', 'Type a search query.');
                    return;
                }
                setStatus('neutral', 'Searching…');
                try {
                    const url = `/api/admin/media/search?q=${encodeURIComponent(q)}&type=all&source=any&limit=24`;
                    const res = await fetchJSON(url);
                    const results = res?.results || [];
                    renderPinResults(results);
                    setStatus('neutral', results.length ? 'Click a result to pin.' : 'No results.');
                } catch (e) {
                    renderPinResults([]);
                    setStatus('error', `Search failed: ${e?.message || 'request failed'}`);
                }
            });
        }

        if (pinQueryEl) {
            const next = pinQueryEl.cloneNode(true);
            pinQueryEl.parentNode.replaceChild(next, pinQueryEl);
            next.addEventListener('keydown', e => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    document.getElementById('override-pin-search-btn')?.click();
                }
            });
        }

        if (pinResultsEl && !pinResultsEl._boundPinClick) {
            pinResultsEl.addEventListener('click', ev => {
                const btn = ev.target?.closest?.('[data-pin-key]');
                if (!btn || !pinResultsEl.contains(btn)) return;
                const key = btn.getAttribute('data-pin-key') || '';
                setPinnedKey(key, true);
                pinResultsEl
                    .querySelectorAll('[data-pin-key]')
                    .forEach(el =>
                        el.classList.toggle(
                            'active',
                            el.getAttribute('data-pin-key') === selectedPinnedKey
                        )
                    );
            });
            pinResultsEl._boundPinClick = true;
        }

        if (applyBtn) {
            const next = applyBtn.cloneNode(true);
            applyBtn.parentNode.replaceChild(next, applyBtn);
            next.addEventListener('click', async () => {
                const mode = safeString(
                    document.getElementById('override-session-mode')?.value || 'multiple'
                );
                const lockedUser = safeString(
                    document.getElementById('override-plex-user')?.value
                ).trim();
                const srcPref = safeString(
                    document.getElementById('override-nowplaying-source')?.value || 'auto'
                ).trim();

                if (mode === 'locked' && !lockedUser) {
                    toast({
                        type: 'error',
                        title: 'Missing user',
                        message: 'Select a Plex user for Locked to user.',
                    });
                    return;
                }

                let ok = 0,
                    fail = 0;
                for (const id of ids) {
                    try {
                        const nextOverride = clone(originals[id] || {});
                        nextOverride.cinema = nextOverride.cinema || {};
                        nextOverride.cinema.nowPlaying = nextOverride.cinema.nowPlaying || {};

                        if (mode === 'locked') {
                            nextOverride.cinema.nowPlaying.priority = 'user';
                            nextOverride.cinema.nowPlaying.filterUser = lockedUser;
                        } else {
                            delete nextOverride.cinema.nowPlaying.priority;
                            delete nextOverride.cinema.nowPlaying.filterUser;
                        }

                        if (srcPref && srcPref !== 'auto') {
                            nextOverride.cinema.nowPlaying.sourcePreference = srcPref;
                        } else {
                            delete nextOverride.cinema.nowPlaying.sourcePreference;
                        }

                        if (selectedPinnedKey) {
                            nextOverride.cinema.pinnedMediaKey = selectedPinnedKey;
                        } else {
                            delete nextOverride.cinema.pinnedMediaKey;
                        }

                        cleanupEmpty(nextOverride);

                        const patchData = { settingsOverride: nextOverride };
                        patchData.plexUsername = mode === 'locked' ? lockedUser : null;

                        await fetchJSON(`/api/devices/${encodeURIComponent(id)}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(patchData),
                        });
                        ok++;
                    } catch (_) {
                        fail++;
                    }
                }

                try {
                    await Promise.all(
                        ids.map(id => sendCommand(id, 'core.mgmt.reload').catch(() => null))
                    );
                } catch (_) {
                    /* best-effort */
                }

                document.getElementById('modal-override')?.classList.remove('open');

                if (ok)
                    toast({
                        type: 'success',
                        title: 'Overrides applied',
                        message: `${ok}/${ids.length} updated`,
                    });
                if (fail)
                    toast({
                        type: 'error',
                        title: 'Some failed',
                        message: `${fail} failed`,
                    });

                await loadDevices?.();
            });
        }

        await hydrateFromDevices();
    }

    return { openOverrideFor };
}
