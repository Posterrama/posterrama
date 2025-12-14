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

        let priorityEl = document.getElementById('override-session-mode');
        const plexUserRow = document.getElementById('override-plex-user-row');
        const plexUserEl = document.getElementById('override-plex-user');
        const sourcePrefEl = document.getElementById('override-nowplaying-source');

        const pinQueryEl = document.getElementById('override-pin-query');
        const pinSearchBtn = document.getElementById('override-pin-search-btn');
        const pinResultsEl = document.getElementById('override-pin-results');
        const pinCurrentTextEl = document.getElementById('override-pin-current-text');
        const pinCurrentThumbEl = document.getElementById('override-pin-current-thumb');
        const pinClearBtn = document.getElementById('override-pin-clear-btn');

        // Always start with a clean search UI when opening.
        clearPinSearchUI();

        // Also clear when closing via Cancel/X/backdrop.
        if (overlay && !overlay._boundOverridePinCleanup) {
            overlay.addEventListener('click', ev => {
                const clickedClose = ev.target?.closest?.('[data-close-modal]');
                const clickedBackdrop = ev.target === overlay;
                if (!clickedClose && !clickedBackdrop) return;
                clearPinSearchUI();
            });
            overlay._boundOverridePinCleanup = true;
        }

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
        const effectivePriorities = [];
        const effectiveUsers = [];
        const sourcePrefs = [];
        const pinnedKeys = [];
        let selectedPinnedKey = '';
        let pinnedLookupSeq = 0;

        function clearPinSearchUI() {
            if (pinQueryEl) pinQueryEl.value = '';
            if (pinResultsEl) pinResultsEl.innerHTML = '';
        }

        async function updatePinnedCurrentUI() {
            if (!pinCurrentTextEl) return;

            if (!selectedPinnedKey) {
                pinCurrentTextEl.textContent = '(none)';
                if (pinCurrentThumbEl) {
                    pinCurrentThumbEl.innerHTML = '';
                    pinCurrentThumbEl.style.display = 'none';
                }
                return;
            }

            const seq = ++pinnedLookupSeq;
            const keyToResolve = selectedPinnedKey;

            // Prefer not showing the raw key while resolving.
            pinCurrentTextEl.textContent = 'Resolving…';
            if (pinCurrentThumbEl) {
                pinCurrentThumbEl.innerHTML = '';
                pinCurrentThumbEl.style.display = 'none';
            }

            try {
                const res = await fetchJSON(
                    `/api/media/lookup?key=${encodeURIComponent(keyToResolve)}`
                );
                const item = res?.result || null;
                const title = safeString(item?.title || item?.name).trim();
                const year = item?.year ? String(item.year).trim() : '';
                const posterUrl = safeString(item?.posterUrl || item?.poster_path).trim();

                if (seq !== pinnedLookupSeq || selectedPinnedKey !== keyToResolve) return;

                if (title) {
                    pinCurrentTextEl.textContent = `${title}${year ? ` (${year})` : ''}`;
                } else {
                    pinCurrentTextEl.textContent = keyToResolve;
                }
                if (pinCurrentThumbEl && posterUrl) {
                    pinCurrentThumbEl.innerHTML = `<img src="${escapeHtml(posterUrl)}" alt="" />`;
                    pinCurrentThumbEl.style.display = 'inline-flex';
                }
            } catch (_) {
                if (seq !== pinnedLookupSeq || selectedPinnedKey !== keyToResolve) return;
                pinCurrentTextEl.textContent = keyToResolve;
            }
        }

        function setPinnedKey(key, fromUserAction = false) {
            selectedPinnedKey = key ? safeString(key) : '';
            updatePinnedCurrentUI();
            if (fromUserAction) {
                setStatus(
                    'neutral',
                    selectedPinnedKey ? 'Pinned selection updated.' : 'Pinned selection cleared.'
                );
            }
        }

        function syncPinnedResultVisuals() {
            if (!pinResultsEl) return;
            pinResultsEl.querySelectorAll('[data-pin-key]').forEach(el => {
                const isActive = el.getAttribute('data-pin-key') === selectedPinnedKey;
                el.classList.toggle('active', isActive);
                const icon = el.querySelector('.pin-result-icon i');
                if (!icon) return;
                icon.classList.toggle('fa-map-pin', isActive);
                icon.classList.toggle('fa-thumbtack', !isActive);
            });
        }

        function renderPinResults(results) {
            if (!pinResultsEl) return;
            const list = Array.isArray(results) ? results : [];
            if (!list.length) {
                pinResultsEl.innerHTML = '<div class="override-hint">No results.</div>';
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
                    const pinIcon = active ? 'fa-map-pin' : 'fa-thumbtack';
                    return `
                        <button type="button" class="pin-result ${active ? 'active' : ''}" data-pin-key="${escapeHtml(
                            key
                        )}">
                            <div class="pin-result-thumb">
                                ${posterUrl ? `<img src="${escapeHtml(posterUrl)}" alt="" />` : ''}
                            </div>
                            <div class="pin-result-meta">
                                <div class="pin-result-title">${escapeHtml(title)}${year}</div>
                                <div class="pin-result-sub">${type}${
                                    type && source ? ' • ' : ''
                                }${source}</div>
                            </div>
                            <div class="pin-result-icon" aria-hidden="true">
                                <i class="fas ${pinIcon}"></i>
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

                const ovPriority = safeString(ov?.cinema?.nowPlaying?.priority || '').trim();
                const ovUser = safeString(ov?.cinema?.nowPlaying?.filterUser || '').trim();
                const devUser = safeString(dev?.plexUsername || '').trim();

                // Determine effective UI state:
                // - If override explicitly sets priority: respect it.
                // - If device has plexUsername but no explicit priority override: treat as Specific user.
                //   (This matches previous "Locked to user" behavior.)
                if (ovPriority) {
                    effectivePriorities.push(ovPriority);
                    if (ovPriority === 'user') effectiveUsers.push(ovUser || devUser || '');
                    else effectiveUsers.push('');
                } else if (devUser) {
                    effectivePriorities.push('user');
                    effectiveUsers.push(devUser);
                } else {
                    effectivePriorities.push('');
                    effectiveUsers.push('');
                }
            });

            const prioritySame = sameOrNull(effectivePriorities);
            const userSame = sameOrNull(effectiveUsers);
            const srcPrefSame = sameOrNull(sourcePrefs);
            const pinnedSame = sameOrNull(pinnedKeys);

            if (priorityEl) priorityEl.value = prioritySame ?? '';
            if (plexUserRow)
                plexUserRow.style.display = priorityEl?.value === 'user' ? 'block' : 'none';

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
                                const sel = userSame && n === userSame ? ' selected' : '';
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
        if (priorityEl) {
            const next = priorityEl.cloneNode(true);
            priorityEl.parentNode.replaceChild(next, priorityEl);
            priorityEl = next;

            const syncUserRow = () => {
                if (!plexUserRow) return;
                plexUserRow.style.display = priorityEl.value === 'user' ? 'block' : 'none';
            };

            next.addEventListener('change', syncUserRow);
            syncUserRow();
        }

        if (pinClearBtn) {
            const next = pinClearBtn.cloneNode(true);
            pinClearBtn.parentNode.replaceChild(next, pinClearBtn);
            next.addEventListener('click', () => {
                setPinnedKey('', true);
                syncPinnedResultVisuals();
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
                    syncPinnedResultVisuals();
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
                syncPinnedResultVisuals();
            });
            pinResultsEl._boundPinClick = true;
        }

        if (applyBtn) {
            const next = applyBtn.cloneNode(true);
            applyBtn.parentNode.replaceChild(next, applyBtn);
            next.addEventListener('click', async () => {
                const priority = safeString(
                    document.getElementById('override-session-mode')?.value
                ).trim();
                const selectedUser = safeString(
                    document.getElementById('override-plex-user')?.value
                ).trim();
                const srcPref = safeString(
                    document.getElementById('override-nowplaying-source')?.value || 'auto'
                ).trim();

                if (priority === 'user' && !selectedUser) {
                    toast({
                        type: 'error',
                        title: 'Missing user',
                        message: 'Select a Plex user for Specific user.',
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

                        if (!priority) {
                            // No override: inherit from global config
                            delete nextOverride.cinema.nowPlaying.priority;
                            delete nextOverride.cinema.nowPlaying.filterUser;
                        } else if (priority === 'user') {
                            nextOverride.cinema.nowPlaying.priority = 'user';
                            nextOverride.cinema.nowPlaying.filterUser = selectedUser;
                        } else {
                            // first/random
                            nextOverride.cinema.nowPlaying.priority = priority;
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
                        patchData.plexUsername = priority === 'user' ? selectedUser : null;

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
                clearPinSearchUI();

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
