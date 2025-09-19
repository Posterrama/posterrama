// Cinema Admin UI — Phase 1 skeleton
// - Load/save config.cinema
// - Render minimal controls: header toggle + text/style, footer toggle + type, ambilight slider
// - Smart show/hide (basic)
(function () {
    const $ = sel => document.querySelector(sel);
    const el = (tag, attrs = {}, children = []) => {
        const n = document.createElement(tag);
        Object.entries(attrs).forEach(([k, v]) => {
            if (k === 'class') n.className = v;
            else if (k === 'for') n.htmlFor = v;
            else if (k.startsWith('on') && typeof v === 'function')
                n.addEventListener(k.substring(2), v);
            else n.setAttribute(k, v);
        });
        (Array.isArray(children) ? children : [children])
            .filter(Boolean)
            .forEach(c => n.append(c.nodeType ? c : document.createTextNode(c)));
        return n;
    };

    // Working state to persist changes across section switches (until Save)
    function getWorkingState() {
        try {
            let s = window.__cinemaWorkingState;
            if (!s) {
                const fromSS = sessionStorage.getItem('cinemaWorkingState');
                s = fromSS ? JSON.parse(fromSS) : {};
                window.__cinemaWorkingState = s;
            }
            if (!s.presets) s.presets = {};
            return s;
        } catch (_) {
            window.__cinemaWorkingState = { presets: {} };
            return window.__cinemaWorkingState;
        }
    }
    function saveWorkingState() {
        try {
            sessionStorage.setItem(
                'cinemaWorkingState',
                JSON.stringify(window.__cinemaWorkingState || {})
            );
        } catch (_) {}
    }

    // Helper: populate a simple <select> with plain options (no separators/specials)
    function populateSimpleSelect(selectEl, items, desiredValue) {
        if (!selectEl) return;
        const opts = (Array.isArray(items) ? items : []).map(v => el('option', { value: v }, v));
        selectEl.replaceChildren(...opts);
        const want = desiredValue ?? selectEl.value;
        selectEl.value = items?.includes(want) ? want : items?.[0] || '';
    }

    // Helper: confirmation shim – uses admin.js confirm modal if available, otherwise native confirm
    function confirmActionShim({
        title = 'Confirm',
        message = 'Are you sure?',
        okText = 'Confirm',
        okClass = 'btn-primary',
    } = {}) {
        try {
            if (typeof window.confirmAction === 'function') {
                return window.confirmAction({ title, message, okText, okClass });
            }
        } catch (_) {}
        // Fallback to native confirm
        const res = window.confirm(message);
        return Promise.resolve(!!res);
    }

    // Helper: unified Manage Texts modal for header/footer presets
    function openManageModal({
        title,
        getItems,
        setItems,
        selectEl,
        contextLabel = 'Preset text',
        placeholder = 'Type preset text…',
    }) {
        try {
            const overlay = document.getElementById('modal-cinema-manage');
            const titleEl = document.getElementById('modal-cinema-manage-title');
            const listEl = document.getElementById('cinema-manage-list');
            const inputEl = document.getElementById('cinema-manage-input');
            const inputLabel = document.getElementById('cinema-manage-input-label');
            const addBtn = document.getElementById('cinema-manage-add');
            const renBtn = document.getElementById('cinema-manage-rename');
            const delBtn = document.getElementById('cinema-manage-delete');
            const doneBtn = document.getElementById('cinema-manage-done');
            if (
                !overlay ||
                !titleEl ||
                !listEl ||
                !inputEl ||
                !addBtn ||
                !renBtn ||
                !delBtn ||
                !doneBtn
            )
                return;

            let selected = '';
            function renderList() {
                const items = getItems() || [];
                listEl.replaceChildren(
                    ...items.map(v => {
                        const b = document.createElement('button');
                        b.type = 'button';
                        b.className = 'btn btn-secondary btn-sm';
                        b.textContent = v;
                        b.setAttribute('data-value', v);
                        if (v === selected) b.classList.add('active');
                        b.addEventListener('click', () => {
                            selected = v;
                            inputEl.value = v;
                            renderList();
                        });
                        return b;
                    })
                );
            }
            function close() {
                addBtn.removeEventListener('click', onAdd);
                renBtn.removeEventListener('click', onRename);
                delBtn.removeEventListener('click', onDelete);
                doneBtn.removeEventListener('click', onDone);
                inputEl.removeEventListener('keydown', onKey);
                overlay
                    .querySelectorAll('[data-close-modal]')
                    ?.forEach(btn => btn.removeEventListener('click', onDone));
                overlay.classList.remove('open');
                overlay.setAttribute('hidden', '');
            }
            function onAdd() {
                const val = (inputEl.value || '').trim();
                if (!val) return;
                const cur = getItems() || [];
                if (!cur.includes(val)) {
                    const next = [...cur, val];
                    setItems(next);
                    populateSimpleSelect(selectEl, next, val);
                } else {
                    populateSimpleSelect(selectEl, cur, val);
                }
                selected = val;
                renderList();
                try {
                    window.__displayPreviewInit && (window.__forcePreviewUpdate?.() || 0);
                } catch (_) {}
            }
            function onRename() {
                const val = (inputEl.value || '').trim();
                if (!val || !selected) return;
                const cur = getItems() || [];
                const idx = cur.indexOf(selected);
                if (idx < 0) return;
                if (cur.includes(val) && val !== selected) {
                    // avoid duplicate names by early-return
                    return;
                }
                const next = [...cur];
                next[idx] = val;
                setItems(next);
                populateSimpleSelect(selectEl, next, val);
                selected = val;
                renderList();
                try {
                    window.__displayPreviewInit && (window.__forcePreviewUpdate?.() || 0);
                } catch (_) {}
            }
            async function onDelete() {
                if (!selected) return;
                const cur = getItems() || [];
                if (!cur.includes(selected)) return;
                const ok = await confirmActionShim({
                    title: 'Delete Text',
                    message: `Remove “${selected}” from presets?`,
                    okText: 'Delete',
                    okClass: 'btn-danger',
                });
                if (!ok) return;
                const next = cur.filter(x => x !== selected);
                setItems(next);
                const desired = next.includes(selectEl.value) ? selectEl.value : next[0] || '';
                populateSimpleSelect(selectEl, next, desired);
                selected = desired;
                inputEl.value = desired || '';
                renderList();
                try {
                    window.__displayPreviewInit && (window.__forcePreviewUpdate?.() || 0);
                } catch (_) {}
            }
            function onDone() {
                close();
            }
            function onKey(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (selected) onRename();
                    else onAdd();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    onDone();
                }
            }

            titleEl.innerHTML = `<i class="fas fa-list"></i> ${title}`;
            if (inputLabel) inputLabel.textContent = contextLabel;
            if (inputEl) inputEl.placeholder = placeholder;
            selected = (selectEl?.value || '').trim();
            inputEl.value = selected || '';
            renderList();

            addBtn.addEventListener('click', onAdd);
            renBtn.addEventListener('click', onRename);
            delBtn.addEventListener('click', onDelete);
            doneBtn.addEventListener('click', onDone);
            inputEl.addEventListener('keydown', onKey);
            overlay
                .querySelectorAll('[data-close-modal]')
                ?.forEach(btn => btn.addEventListener('click', onDone, { once: true }));

            overlay.removeAttribute('hidden');
            overlay.classList.add('open');
            inputEl.focus();
            if (inputEl.value) inputEl.select();
        } catch (_) {}
    }

    async function loadAdminConfig() {
        try {
            const r = await fetch('/api/admin/config', { credentials: 'include' });
            const j = await r.json();
            return j?.config || {};
        } catch (e) {
            console.error('Cinema UI: failed to load config', e);
            return {};
        }
    }
    // Note: Saving is handled by the main Display Save button in admin.js.
    // This module only collects values and updates UI; no direct POSTs here.

    // Local working state for presets (kept in-memory until main Save)
    let headerPresets = ['Coming Soon', 'Now Playing', 'Home Cinema', 'Feature Presentation'];
    let footerPresets = ['Coming Soon', 'Now Playing', 'Home Cinema', 'Feature Presentation'];

    function mountHeader(container, cfg) {
        const c = cfg.cinema || {};
        const h = c.header || { enabled: true, text: 'Now Playing', style: 'classic' };
        const wsH = getWorkingState();
        headerPresets =
            Array.isArray(wsH.presets?.headerTexts) && wsH.presets.headerTexts.length
                ? [...wsH.presets.headerTexts]
                : Array.isArray(c.presets?.headerTexts) && c.presets.headerTexts.length
                  ? [...c.presets.headerTexts]
                  : ['Coming Soon', 'Now Playing', 'Home Cinema', 'Feature Presentation'];

        // Place the enable switch in the card title as a pill-style header toggle
        try {
            const card = document.getElementById('cinema-header-card');
            const title = card?.querySelector('.card-title');
            if (title && !document.getElementById('cin-h-enabled')) {
                const toggle = el('label', { class: 'header-toggle', for: 'cin-h-enabled' }, [
                    el('input', {
                        type: 'checkbox',
                        id: 'cin-h-enabled',
                        checked: h.enabled ? 'checked' : null,
                    }),
                    el('span', { class: 'ht-switch', 'aria-hidden': 'true' }),
                    el('span', { class: 'ht-text' }, 'Show header'),
                ]);
                title.appendChild(toggle);
            } else {
                const existing = document.getElementById('cin-h-enabled');
                if (existing) existing.checked = !!h.enabled;
            }
        } catch (_) {
            /* ignore */
        }

        const rowText = el('div', { class: 'form-row cin-col' }, [
            el('label', { for: 'cin-h-presets' }, 'Header text'),
            el('div', { class: 'cinema-inline' }, [
                el('select', { id: 'cin-h-presets', class: 'cin-compact' }, []),
                el(
                    'button',
                    {
                        type: 'button',
                        class: 'btn btn-secondary btn-sm',
                        id: 'cin-h-manage',
                        style: 'margin-left:8px',
                    },
                    [el('i', { class: 'fas fa-list' }), el('span', {}, ' Manage')]
                ),
            ]),
        ]);

        const rowStyle = el('div', { class: 'form-row cin-col' }, [
            el('label', { for: 'cin-h-style' }, 'Marquee style'),
            el(
                'select',
                { id: 'cin-h-style' },
                ['classic', 'neon', 'minimal', 'theatre'].map(s => el('option', {}, s))
            ),
        ]);

        const grid = el('div', { class: 'cin-grid-2' }, [rowText, rowStyle]);
        container.replaceChildren(grid);

        // initialize values
        $('#cin-h-style').value = h.style || 'classic';
        (function () {
            const sel = document.getElementById('cin-h-presets');
            const desired =
                wsH.header?.text && headerPresets.includes(wsH.header.text)
                    ? wsH.header.text
                    : headerPresets.includes(h.text)
                      ? h.text
                      : headerPresets[0];
            populateSimpleSelect(sel, headerPresets, desired);
        })();
        // Wire Manage button for header texts
        document.getElementById('cin-h-manage')?.addEventListener('click', () =>
            openManageModal({
                title: 'Manage Header Texts',
                getItems: () => headerPresets,
                setItems: next => {
                    headerPresets = Array.isArray(next) ? [...next] : [];
                    const ws = getWorkingState();
                    ws.presets.headerTexts = [...headerPresets];
                    saveWorkingState();
                },
                selectEl: document.getElementById('cin-h-presets'),
                contextLabel: 'Header text',
                placeholder: 'Type header text…',
            })
        );
        // Simple change hook to allow live summary/preview to react
        $('#cin-h-presets').addEventListener('change', () => {
            const ws = getWorkingState();
            ws.header = Object.assign({}, ws.header, {
                text: document.getElementById('cin-h-presets')?.value || '',
            });
            saveWorkingState();
            try {
                window.__displayPreviewInit && (window.__forcePreviewUpdate?.() || 0);
            } catch (_) {}
        });

        // Simple preset CRUD stored in config.json under cinema.presets.headerTexts
        // Note: individual buttons removed; management happens through the dropdown options above
    }

    function mountFooter(container, cfg) {
        const c = cfg.cinema || {};
        const f = c.footer || {
            enabled: true,
            type: 'specs',
            marqueeText: 'Feature Presentation',
            marqueeStyle: 'classic',
            specs: {
                showResolution: true,
                showAudio: true,
                showAspectRatio: true,
                showFlags: false,
                style: 'subtle',
                iconSet: 'filled',
            },
        };
        const wsF = getWorkingState();
        footerPresets =
            Array.isArray(wsF.presets?.footerTexts) && wsF.presets.footerTexts.length
                ? [...wsF.presets.footerTexts]
                : Array.isArray(c.presets?.footerTexts) && c.presets.footerTexts.length
                  ? [...c.presets.footerTexts]
                  : ['Coming Soon', 'Now Playing', 'Home Cinema', 'Feature Presentation'];

        // Place the enable switch in the card title as a pill-style header toggle
        try {
            const card = document.getElementById('cinema-footer-card');
            const title = card?.querySelector('.card-title');
            if (title && !document.getElementById('cin-f-enabled')) {
                const toggle = el('label', { class: 'header-toggle', for: 'cin-f-enabled' }, [
                    el('input', {
                        type: 'checkbox',
                        id: 'cin-f-enabled',
                        checked: f.enabled ? 'checked' : null,
                    }),
                    el('span', { class: 'ht-switch', 'aria-hidden': 'true' }),
                    el('span', { class: 'ht-text' }, 'Show footer'),
                ]);
                title.appendChild(toggle);
            } else {
                const existing = document.getElementById('cin-f-enabled');
                if (existing) existing.checked = !!f.enabled;
            }
        } catch (_) {
            /* ignore */
        }

        // Controls row: Footer type (left) + contextual Style (right)
        const ctrlType = el('div', { class: 'form-row' }, [
            el('label', { for: 'cin-f-type' }, 'Footer type'),
            el(
                'select',
                { id: 'cin-f-type', class: 'cin-compact' },
                ['marquee', 'specs'].map(s => el('option', {}, s))
            ),
        ]);
        const styleSlot = el('div', { id: 'cin-f-style-slot' }, []);
        const controlsGrid = el('div', { class: 'cin-footer-controls' }, [ctrlType, styleSlot]);

        // Marquee: Footer text
        const mRowText = el('div', { class: 'form-row cin-col' }, [
            el('label', { for: 'cin-f-presets' }, 'Footer text'),
            el('div', { class: 'cinema-inline' }, [
                el('select', { id: 'cin-f-presets', class: 'cin-compact' }, []),
                el(
                    'button',
                    {
                        type: 'button',
                        class: 'btn btn-secondary btn-sm',
                        id: 'cin-f-manage',
                        style: 'margin-left:8px',
                    },
                    [el('i', { class: 'fas fa-list' }), el('span', {}, ' Manage')]
                ),
            ]),
        ]);
        const marqueeStyleRow = el('div', { class: 'form-row cin-col' }, [
            el('label', { for: 'cin-f-style' }, 'Style'),
            el(
                'select',
                { id: 'cin-f-style', class: 'cin-compact' },
                ['classic', 'neon', 'minimal', 'theatre'].map(s => el('option', {}, s))
            ),
        ]);
        const marqueeBlock = el('div', { id: 'cin-f-marquee', class: 'cin-footer-col' }, [
            el('div', { class: 'cin-grid-2' }, [mRowText]),
        ]);

        // Specs in a two-column inner grid: left (Show checklist), right (Style + Icons)
        const sLeft = el('div', { class: 'form-row' }, [
            el('label', {}, 'Show:'),
            el('div', { class: 'cin-vert' }, [
                el('label', {}, [
                    el('input', {
                        type: 'checkbox',
                        id: 'cin-f-s-res',
                        checked: f.specs?.showResolution ? 'checked' : null,
                    }),
                    ' Resolution',
                ]),
                el('label', {}, [
                    el('input', {
                        type: 'checkbox',
                        id: 'cin-f-s-aud',
                        checked: f.specs?.showAudio ? 'checked' : null,
                    }),
                    ' Audio',
                ]),
                el('label', {}, [
                    el('input', {
                        type: 'checkbox',
                        id: 'cin-f-s-asp',
                        checked: f.specs?.showAspectRatio ? 'checked' : null,
                    }),
                    ' Aspect Ratio',
                ]),
                el('label', {}, [
                    el('input', {
                        type: 'checkbox',
                        id: 'cin-f-s-flag',
                        checked: f.specs?.showFlags ? 'checked' : null,
                    }),
                    ' Flags',
                ]),
            ]),
            // Icons dropdown moved under the Show list for left alignment
            (function () {
                const wrap = document.createElement('div');
                wrap.className = 'icons-row';
                wrap.appendChild(el('label', { for: 'cin-f-s-icons' }, 'Icons'));
                wrap.appendChild(
                    el(
                        'select',
                        { id: 'cin-f-s-icons', class: 'cin-compact' },
                        ['filled', 'line'].map(s => el('option', {}, s))
                    )
                );
                return wrap;
            })(),
        ]);
        const specsBlock = el('div', { id: 'cin-f-specs', class: 'cin-footer-col' }, [
            el('div', { class: 'specs-grid' }, [sLeft]),
        ]);

        // Compose new layout: controls row + content blocks
        container.replaceChildren(controlsGrid, marqueeBlock, specsBlock);

        // init values & logic
        $('#cin-f-type').value = f.type || 'specs';
        // Defer setting #cin-f-style until it's inserted into the DOM by syncBlocks
        const savedMarqueeText = f.marqueeText;
        (function () {
            const sel = document.getElementById('cin-f-presets');
            const desired =
                wsF.footer?.marqueeText && footerPresets.includes(wsF.footer.marqueeText)
                    ? wsF.footer.marqueeText
                    : footerPresets.includes(savedMarqueeText)
                      ? savedMarqueeText
                      : footerPresets[0];
            populateSimpleSelect(sel, footerPresets, desired);
        })();
        // Wire Manage button for footer texts
        document.getElementById('cin-f-manage')?.addEventListener('click', () =>
            openManageModal({
                title: 'Manage Footer Texts',
                getItems: () => footerPresets,
                setItems: next => {
                    footerPresets = Array.isArray(next) ? [...next] : [];
                    const ws = getWorkingState();
                    ws.presets.footerTexts = [...footerPresets];
                    saveWorkingState();
                },
                selectEl: document.getElementById('cin-f-presets'),
                contextLabel: 'Footer text',
                placeholder: 'Type footer text…',
            })
        );
        // Change hook for preview updates
        $('#cin-f-presets').addEventListener('change', () => {
            const ws = getWorkingState();
            ws.footer = Object.assign({}, ws.footer, {
                marqueeText: document.getElementById('cin-f-presets')?.value || '',
            });
            saveWorkingState();
            try {
                window.__displayPreviewInit && (window.__forcePreviewUpdate?.() || 0);
            } catch (_) {}
        });
        // Create the specs Style control; inserted in the style slot when type='specs'
        const specsStyleRow = (function () {
            const wrap = document.createElement('div');
            wrap.className = 'form-row';
            wrap.appendChild(el('label', { for: 'cin-f-s-style' }, 'Style'));
            wrap.appendChild(
                el(
                    'select',
                    { id: 'cin-f-s-style', class: 'cin-compact' },
                    ['subtle', 'filled', 'outline'].map(s => el('option', {}, s))
                )
            );
            return wrap;
        })();
        // Initialize default values
        // Note: set after insertion by syncBlocks
        $('#cin-f-s-icons').value = f.specs?.iconSet || 'filled';

        const syncBlocks = () => {
            const t = $('#cin-f-type').value;
            const showMarq = t === 'marquee';
            const showSpecs = t === 'specs';
            $('#cin-f-marquee').style.display = showMarq ? 'block' : 'none';
            $('#cin-f-specs').style.display = showSpecs ? 'block' : 'none';
            // Manage Style slot: show the appropriate Style control next to Footer type
            const slot = document.getElementById('cin-f-style-slot');
            if (slot) {
                slot.replaceChildren();
                if (showSpecs) {
                    slot.appendChild(specsStyleRow);
                    const sel = document.getElementById('cin-f-s-style');
                    if (sel && !sel.dataset.init) {
                        sel.value = f.specs?.style || 'subtle';
                        sel.dataset.init = '1';
                    }
                } else if (showMarq) {
                    slot.appendChild(marqueeStyleRow);
                    const selM = document.getElementById('cin-f-style');
                    if (selM && !selM.dataset.init) {
                        selM.value = f.marqueeStyle || 'classic';
                        selM.dataset.init = '1';
                    }
                }
            }
        };
        $('#cin-f-type').addEventListener('change', syncBlocks);
        syncBlocks();

        // Footer presets CRUD stored in config.json under cinema.presets.footerTexts
        // Buttons removed; management via dropdown special options
    }

    function mountAmbilight(container, cfg) {
        const c = cfg.cinema || {};
        const a = c.ambilight || { enabled: true, strength: 60 };
        // Move toggle to card title as header pill switch
        try {
            const card = document.getElementById('cinema-ambilight-card');
            const title = card?.querySelector('.card-title');
            if (title && !document.getElementById('cin-a-enabled')) {
                const toggle = el('label', { class: 'header-toggle', for: 'cin-a-enabled' }, [
                    el('input', {
                        type: 'checkbox',
                        id: 'cin-a-enabled',
                        checked: a.enabled ? 'checked' : null,
                    }),
                    el('span', { class: 'ht-switch', 'aria-hidden': 'true' }),
                    el('span', { class: 'ht-text' }, 'Enable ambilight'),
                ]);
                title.appendChild(toggle);
            } else {
                const existing = document.getElementById('cin-a-enabled');
                if (existing) existing.checked = !!a.enabled;
            }
        } catch (_) {
            /* ignore */
        }
        const rowStrength = el('div', { class: 'form-row' }, [
            el('label', { for: 'cin-a-strength' }, 'Intensity'),
            el('input', {
                type: 'range',
                id: 'cin-a-strength',
                min: '0',
                max: '100',
                value: String(a.strength ?? 60),
            }),
        ]);
        container.replaceChildren(rowStrength);
    }

    function collectCinemaOnly(baseCfg) {
        const cfg = baseCfg || {};
        const header = {
            enabled: $('#cin-h-enabled')?.checked || false,
            text: $('#cin-h-presets')?.value || 'Now Playing',
            style: $('#cin-h-style')?.value || 'classic',
        };
        const footer = {
            enabled: $('#cin-f-enabled')?.checked || false,
            type: $('#cin-f-type')?.value || 'specs',
            marqueeText: $('#cin-f-presets')?.value || 'Feature Presentation',
            marqueeStyle: $('#cin-f-style')?.value || 'classic',
            specs: {
                showResolution: $('#cin-f-s-res')?.checked || false,
                showAudio: $('#cin-f-s-aud')?.checked || false,
                showAspectRatio: $('#cin-f-s-asp')?.checked || false,
                showFlags: $('#cin-f-s-flag')?.checked || false,
                style: $('#cin-f-s-style')?.value || 'subtle',
                iconSet: $('#cin-f-s-icons')?.value || 'filled',
            },
        };
        const ambilight = {
            enabled: $('#cin-a-enabled')?.checked || false,
            strength: parseInt($('#cin-a-strength')?.value || '60', 10),
        };
        // Presets reflect local working state
        const presets = {
            headerTexts:
                Array.isArray(headerPresets) && headerPresets.length
                    ? [...headerPresets]
                    : cfg.cinema?.presets?.headerTexts || [],
            footerTexts:
                Array.isArray(footerPresets) && footerPresets.length
                    ? [...footerPresets]
                    : cfg.cinema?.presets?.footerTexts || [],
        };
        return { header, footer, ambilight, presets };
    }

    async function init() {
        const cfg = await loadAdminConfig();
        const cm = $('#card-cinema');
        if (!cm) return;
        mountHeader($('#cinema-header-mount'), cfg);
        mountFooter($('#cinema-footer-mount'), cfg);
        mountAmbilight($('#cinema-ambilight-mount'), cfg);
        // Mount presets card
        try {
            const slot = document.getElementById('cinema-presets-mount');
            if (slot) {
                const presetsRow = document.createElement('div');
                presetsRow.className = 'scaling-presets';
                presetsRow.style.display = 'flex';
                presetsRow.style.flexWrap = 'wrap';
                presetsRow.style.gap = '8px';
                presetsRow.innerHTML = [
                    '<button type="button" class="btn btn-secondary btn-sm" data-cin-preset="poster"><i class="fas fa-image"></i> <span>Poster Focus</span></button>',
                    '<button type="button" class="btn btn-secondary btn-sm" data-cin-preset="feature"><i class="fas fa-star"></i> <span>Feature Night</span></button>',
                    '<button type="button" class="btn btn-secondary btn-sm" data-cin-preset="tech"><i class="fas fa-microchip"></i> <span>Tech Specs</span></button>',
                    '<button type="button" class="btn btn-outline btn-sm" data-cin-preset="reset"><i class="fas fa-undo"></i> <span>Reset</span></button>',
                ].join('');

                const summaryTitle = document.createElement('div');
                summaryTitle.className = 'card-title';
                summaryTitle.style.cssText = 'font-size:.95rem; margin:10px 0 6px;';
                summaryTitle.innerHTML = '<i class="fas fa-info-circle"></i> Current Experience';

                const summary = document.createElement('div');
                summary.id = 'cinema-summary';
                summary.style.cssText =
                    'display:flex; flex-wrap:wrap; gap:8px; align-items:center;';
                summary.innerHTML = [
                    '<span class="status-pill" id="cin-sum-orient" title="Orientation">Orientation: —</span>',
                    '<span class="status-pill" id="cin-sum-header" title="Header status">Header: —</span>',
                    '<span class="status-pill" id="cin-sum-footer" title="Footer type">Footer: —</span>',
                    '<span class="status-pill" id="cin-sum-ambilight" title="Ambilight strength">Ambilight: —</span>',
                ].join('');

                slot.replaceChildren(presetsRow, summaryTitle, summary);

                const q = sel => document.querySelector(sel);
                const setVal = (id, value) => {
                    const el = document.getElementById(id);
                    if (!el) return;
                    if (el.type === 'checkbox') {
                        el.checked = !!value;
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                        return;
                    }
                    el.value = String(value);
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                };
                const applyPreset = name => {
                    switch (name) {
                        case 'poster':
                            // Big poster with marquee header, minimal footer
                            setVal('cin-a-enabled', true);
                            setVal('cin-a-strength', 50);
                            setVal('cin-h-enabled', true);
                            setVal('cin-h-presets', 'Now Playing');
                            setVal('cin-h-style', 'classic');
                            setVal('cin-f-enabled', true);
                            setVal('cin-f-type', 'marquee');
                            // ensure style slot swaps
                            document
                                .getElementById('cin-f-type')
                                ?.dispatchEvent(new Event('change', { bubbles: true }));
                            setVal('cin-f-style', 'classic');
                            break;
                        case 'feature':
                            // Theatre vibe: marquee header + marquee footer, stronger ambilight
                            setVal('cin-a-enabled', true);
                            setVal('cin-a-strength', 70);
                            setVal('cin-h-enabled', true);
                            setVal('cin-h-presets', 'Feature Presentation');
                            setVal('cin-h-style', 'theatre');
                            setVal('cin-f-enabled', true);
                            setVal('cin-f-type', 'marquee');
                            document
                                .getElementById('cin-f-type')
                                ?.dispatchEvent(new Event('change', { bubbles: true }));
                            setVal('cin-f-style', 'theatre');
                            break;
                        case 'tech':
                            // Specifications focus: no header, specs footer with all badges filled
                            setVal('cin-a-enabled', false);
                            setVal('cin-h-enabled', false);
                            setVal('cin-f-enabled', true);
                            setVal('cin-f-type', 'specs');
                            document
                                .getElementById('cin-f-type')
                                ?.dispatchEvent(new Event('change', { bubbles: true }));
                            setVal('cin-f-s-style', 'filled');
                            setVal('cin-f-s-icons', 'filled');
                            setVal('cin-f-s-res', true);
                            setVal('cin-f-s-aud', true);
                            setVal('cin-f-s-asp', true);
                            setVal('cin-f-s-flag', true);
                            break;
                        default:
                            // Reset to reasonable defaults
                            setVal('cin-a-enabled', true);
                            setVal('cin-a-strength', 60);
                            setVal('cin-h-enabled', true);
                            setVal('cin-h-presets', 'Now Playing');
                            setVal('cin-h-style', 'classic');
                            setVal('cin-f-enabled', true);
                            setVal('cin-f-type', 'specs');
                            document
                                .getElementById('cin-f-type')
                                ?.dispatchEvent(new Event('change', { bubbles: true }));
                            setVal('cin-f-s-style', 'subtle');
                            setVal('cin-f-s-icons', 'filled');
                            setVal('cin-f-s-res', true);
                            setVal('cin-f-s-aud', true);
                            setVal('cin-f-s-asp', true);
                            setVal('cin-f-s-flag', false);
                    }
                    try {
                        window.__displayPreviewInit && (window.__forcePreviewUpdate?.() || 0);
                    } catch (e) {}
                };
                slot.addEventListener('click', e => {
                    const btn = e.target.closest('button[data-cin-preset]');
                    if (!btn) return;
                    applyPreset(btn.getAttribute('data-cin-preset'));
                });

                // Live summary pills reflecting current controls
                const pills = {
                    orient: document.getElementById('cin-sum-orient'),
                    header: document.getElementById('cin-sum-header'),
                    footer: document.getElementById('cin-sum-footer'),
                    ambi: document.getElementById('cin-sum-ambilight'),
                };
                const refreshSummary = () => {
                    const orientSel = document.getElementById('cinemaOrientation');
                    const orient = (orientSel?.value || 'auto').replace('-', ' ');
                    const hOn = document.getElementById('cin-h-enabled')?.checked;
                    const hStyle = document.getElementById('cin-h-style')?.value || 'classic';
                    const hText = document.getElementById('cin-h-presets')?.value || '';
                    const fOn = document.getElementById('cin-f-enabled')?.checked;
                    const fType = document.getElementById('cin-f-type')?.value || 'specs';
                    const fStyleSpecs = document.getElementById('cin-f-s-style')?.value || 'subtle';
                    const fStyleMarq = document.getElementById('cin-f-style')?.value || 'classic';
                    const ambiOn = document.getElementById('cin-a-enabled')?.checked;
                    const ambiStr = document.getElementById('cin-a-strength')?.value || '0';
                    if (pills.orient) pills.orient.textContent = `Orientation: ${orient}`;
                    if (pills.header)
                        pills.header.textContent = hOn
                            ? `Header: ${hText || 'text'} (${hStyle})`
                            : 'Header: off';
                    if (pills.footer)
                        pills.footer.textContent = fOn
                            ? `Footer: ${fType} (${fType === 'specs' ? fStyleSpecs : fStyleMarq})`
                            : 'Footer: off';
                    if (pills.ambi)
                        pills.ambi.textContent = ambiOn
                            ? `Ambilight: ${ambiStr}%`
                            : 'Ambilight: off';
                };
                // Initial and reactive updates
                refreshSummary();
                const section = document.getElementById('section-display');
                section?.addEventListener('input', refreshSummary, true);
                section?.addEventListener('change', refreshSummary, true);
            }
        } catch (_) {}
        // Expose a collector for admin.js to merge into its save payload
        window.__collectCinemaConfig = () => {
            try {
                return collectCinemaOnly(cfg || {});
            } catch (e) {
                console.error('Cinema UI: failed to collect config', e);
                return undefined;
            }
        };
    }
    document.addEventListener('DOMContentLoaded', init);
})();
