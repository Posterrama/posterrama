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
            else if (k === 'checked') {
                // Handle boolean checked attribute properly
                if (v === true || v === 'checked') n.checked = true;
                // Don't set checked for false/null/undefined
            } else if (k.startsWith('on') && typeof v === 'function')
                n.addEventListener(k.substring(2), v);
            else if (v !== null && v !== undefined) n.setAttribute(k, v);
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
            // failed to parse working state from sessionStorage; start fresh
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
        } catch (_) {
            // swallow manage modal wiring errors (non-critical UI enhancement)
        }
    }

    /**
     * Calculate ton-sur-ton (tonal) color based on background color.
     * Creates an elegant, readable text color in the same hue family.
     * @param {string} bgColor - Background color in hex format
     * @returns {string} Calculated text color in hex format
     */
    function _calculateTonSurTon(bgColor) {
        // Parse hex color
        let hex = bgColor.replace('#', '');
        if (hex.length === 3) {
            hex = hex
                .split('')
                .map(c => c + c)
                .join('');
        }
        const r = parseInt(hex.substr(0, 2), 16);
        const g = parseInt(hex.substr(2, 2), 16);
        const b = parseInt(hex.substr(4, 2), 16);

        // Convert to HSL
        const rNorm = r / 255;
        const gNorm = g / 255;
        const bNorm = b / 255;
        const max = Math.max(rNorm, gNorm, bNorm);
        const min = Math.min(rNorm, gNorm, bNorm);
        let h;
        let s;
        const l = (max + min) / 2;

        if (max === min) {
            h = s = 0; // achromatic
        } else {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case rNorm:
                    h = ((gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0)) / 6;
                    break;
                case gNorm:
                    h = ((bNorm - rNorm) / d + 2) / 6;
                    break;
                case bNorm:
                    h = ((rNorm - gNorm) / d + 4) / 6;
                    break;
            }
        }

        // Calculate luminance to determine if bg is dark or light
        const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
        const isDark = luminance < 128;

        // Create ton-sur-ton: same hue, adjusted lightness
        // For dark backgrounds: lighter version (70-85% lightness)
        // For light backgrounds: darker version (20-35% lightness)
        let newL;
        if (isDark) {
            // Dark background: create elegant light tint
            newL = 0.75 + l * 0.1; // 75-85% lightness
            s = Math.min(s * 0.7, 0.4); // Reduce saturation for elegance
        } else {
            // Light background: create elegant dark shade
            newL = 0.25 - l * 0.1; // 15-25% lightness
            s = Math.min(s * 0.6, 0.35); // Reduce saturation for elegance
        }
        newL = Math.max(0.15, Math.min(0.85, newL));

        // Convert HSL back to RGB
        const hslToRgb = (h, s, l) => {
            let r, g, b;
            if (s === 0) {
                r = g = b = l;
            } else {
                const hue2rgb = (p, q, t) => {
                    if (t < 0) t += 1;
                    if (t > 1) t -= 1;
                    if (t < 1 / 6) return p + (q - p) * 6 * t;
                    if (t < 1 / 2) return q;
                    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
                    return p;
                };
                const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
                const p = 2 * l - q;
                r = hue2rgb(p, q, h + 1 / 3);
                g = hue2rgb(p, q, h);
                b = hue2rgb(p, q, h - 1 / 3);
            }
            return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
        };

        const [newR, newG, newB] = hslToRgb(h, s, newL);
        return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
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
        } catch (e) {
            // ignore preview update failure
            void e; // no-op reference
        }
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
        systemPresets = [],
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

            // Helper to get combined presets for dropdown
            const getAllPresets = () => [
                ...systemPresets,
                ...(getItems() || []).filter(p => !systemPresets.includes(p)),
            ];

            let selected = '';
            const renderList = () => {
                const items = getItems() || [];
                if (items.length === 0) {
                    listEl.innerHTML =
                        '<p style="color:var(--color-secondary);font-size:0.85rem;margin:8px 0;">No custom texts yet. Add one below.</p>';
                    return;
                }
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
            };
            const close = () => {
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
            };
            const onAdd = () => {
                const val = (inputEl.value || '').trim();
                if (!val) return;
                // Don't allow adding system preset names as custom
                if (systemPresets.includes(val)) return;
                const cur = getItems() || [];
                if (!cur.includes(val)) {
                    const next = [...cur, val];
                    setItems(next);
                    populateSimpleSelect(selectEl, getAllPresets(), val);
                } else {
                    populateSimpleSelect(selectEl, getAllPresets(), val);
                }
                selected = val;
                inputEl.value = '';
                renderList();
                try {
                    window.__displayPreviewInit && (window.__forcePreviewUpdate?.() || 0);
                } catch (e) {
                    // ignore preview update failure after add
                }
            };
            const onRename = () => {
                const val = (inputEl.value || '').trim();
                if (!val || !selected) return;
                // Don't allow renaming to system preset names
                if (systemPresets.includes(val)) return;
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
                populateSimpleSelect(selectEl, getAllPresets(), val);
                selected = val;
                renderList();
                try {
                    window.__displayPreviewInit && (window.__forcePreviewUpdate?.() || 0);
                } catch (e) {
                    // ignore preview update failure after rename
                }
            };
            const onDelete = async () => {
                if (!selected) return;
                const cur = getItems() || [];
                if (!cur.includes(selected)) return;
                const ok = await confirmActionShim({
                    title: 'Delete Text',
                    message: `Remove “${selected}” from custom presets?`,
                    okText: 'Delete',
                    okClass: 'btn-danger',
                });
                if (!ok) return;
                const next = cur.filter(x => x !== selected);
                setItems(next);
                const desired = next.includes(selectEl.value) ? selectEl.value : next[0] || '';
                const allPresets = getAllPresets();
                populateSimpleSelect(selectEl, allPresets, desired);
                selected = desired;
                inputEl.value = desired || '';
                renderList();
                try {
                    window.__displayPreviewInit && (window.__forcePreviewUpdate?.() || 0);
                } catch (e) {
                    // ignore preview update failure after delete
                }
            };
            const onDone = () => {
                close();
            };
            const onKey = e => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (selected) onRename();
                    else onAdd();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    onDone();
                }
            };

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
        } catch (_) {
            // manage modal failed to open (missing DOM nodes)
            void 0;
        }
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

    // System presets - always available, not editable via Manage
    // Shared between Header and Footer
    const SYSTEM_TEXT_PRESETS = [
        'Now Playing',
        'Coming Soon',
        'Certified Fresh',
        'Late Night Feature',
        'Weekend Matinee',
        'New Arrival',
        '4K Ultra HD',
        'Home Cinema',
        'Feature Presentation',
    ];

    // Local working state for user presets (shared between header and footer)
    let userTextPresets = [];

    // Combined presets (system + user) for dropdowns - same for header and footer
    function getAllTextPresets() {
        return [
            ...SYSTEM_TEXT_PRESETS,
            ...userTextPresets.filter(p => !SYSTEM_TEXT_PRESETS.includes(p)),
        ];
    }

    function mountHeader(container, cfg) {
        const c = cfg.cinema || {};
        const h = c.header || { enabled: true, text: 'Now Playing', typography: {} };
        const typo = h.typography || {};
        const wsH = getWorkingState();
        // Load user presets (custom texts added via Manage, excluding system presets)
        // User presets are shared between header and footer
        const savedPresets =
            Array.isArray(wsH.presets?.headerTexts) && wsH.presets.headerTexts.length
                ? wsH.presets.headerTexts
                : Array.isArray(c.presets?.headerTexts) && c.presets.headerTexts.length
                  ? c.presets.headerTexts
                  : [];
        userTextPresets = savedPresets.filter(p => !SYSTEM_TEXT_PRESETS.includes(p));

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
            // header toggle mount failure ignored (card not present yet)
            void 0;
        }

        // Header Text row
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

        // Context Headers section
        const ctx = h.contextHeaders || {};
        // Default priority order (can be customized by user)
        const defaultPriorityOrder = [
            'nowPlaying',
            'ultra4k',
            'certifiedFresh',
            'comingSoon',
            'newArrival',
            'lateNight',
            'weekend',
        ];
        const contextMeta = {
            default: {
                label: 'Default (Fallback)',
                defaultVal: 'Now Playing',
                noInherit: true,
                noPriority: true,
            },
            nowPlaying: {
                label: 'Now Playing',
                defaultVal: 'Now Playing',
                hint: 'Active playback',
            },
            comingSoon: { label: 'Coming Soon', defaultVal: 'Coming Soon', hint: 'Unreleased' },
            certifiedFresh: {
                label: 'Certified Fresh',
                defaultVal: 'Certified Fresh',
                hint: 'RT ≥ 90%',
            },
            lateNight: {
                label: 'Late Night',
                defaultVal: 'Late Night Feature',
                hint: '23:00-06:00',
            },
            weekend: { label: 'Weekend', defaultVal: 'Weekend Matinee', hint: 'Sat/Sun' },
            newArrival: { label: 'New Arrival', defaultVal: 'New Arrival', hint: '< 7 days' },
            ultra4k: { label: '4K Ultra HD', defaultVal: '4K Ultra HD', hint: '4K content' },
        };
        // Load saved priority order or use default
        let priorityOrder =
            Array.isArray(ctx.priorityOrder) &&
            ctx.priorityOrder.length === defaultPriorityOrder.length
                ? [...ctx.priorityOrder]
                : [...defaultPriorityOrder];

        // Context Headers enable toggle row
        const contextHeaderToggle = el('div', { class: 'form-row', id: 'cin-ctx-toggle-row' }, [
            el('label', { for: 'cin-ctx-enabled' }, 'Context Headers'),
            el('label', { class: 'checkbox', for: 'cin-ctx-enabled' }, [
                el('input', {
                    type: 'checkbox',
                    id: 'cin-ctx-enabled',
                    checked: ctx.enabled ? 'checked' : null,
                }),
                el('span', { class: 'checkmark' }),
                el('span', {}, 'Smart context-aware headers'),
            ]),
        ]);

        // Build context header rows with priority numbers and drag handles
        const allPresets = getAllTextPresets();

        const buildContextRow = (key, priorityIndex) => {
            const meta = contextMeta[key];
            const selectOptions = [];
            // Add "Inherit" option for non-default contexts
            if (!meta.noInherit) {
                selectOptions.push(el('option', { value: '__inherit__' }, '↩ Inherit'));
            }
            // Add all presets as options
            allPresets.forEach(preset => {
                selectOptions.push(el('option', { value: preset }, preset));
            });

            const _currentValue = ctx[key] !== undefined ? ctx[key] : meta.defaultVal;
            const selectId = `cin-ctx-${key}`;
            const priorityLabel = meta.noPriority ? '' : `#${priorityIndex + 1}`;

            const row = el(
                'div',
                {
                    class: meta.noPriority ? 'ctx-default-row' : 'ctx-sortable',
                    'data-ctx-key': key,
                },
                [
                    // Drag handle (only for sortable items)
                    !meta.noPriority
                        ? el('span', { class: 'ctx-drag-handle', title: 'Drag to reorder' }, '⠿')
                        : null,
                    // Priority badge
                    !meta.noPriority
                        ? el('span', { class: 'ctx-priority-badge' }, priorityLabel)
                        : null,
                    // Label with hint
                    el(
                        'div',
                        { class: 'ctx-label-wrap' },
                        [
                            el('label', { for: selectId, class: 'ctx-label' }, meta.label),
                            meta.hint ? el('span', { class: 'ctx-hint' }, meta.hint) : null,
                        ].filter(Boolean)
                    ),
                    // Dropdown
                    el('div', { class: 'select-wrap has-caret ctx-select-wrap' }, [
                        el('select', { id: selectId, class: 'cin-compact' }, selectOptions),
                        el('span', { class: 'select-caret', 'aria-hidden': 'true' }, '▾'),
                    ]),
                ].filter(Boolean)
            );

            return row;
        };

        // Build default row (always first, not draggable)
        const defaultRow = buildContextRow('default', -1);

        // Build sortable rows based on priority order
        const sortableContainer = el('div', {
            id: 'cin-ctx-sortable',
            class: 'ctx-sortable-container',
        });

        const rebuildSortableRows = () => {
            const rows = priorityOrder.map((key, idx) => buildContextRow(key, idx));
            sortableContainer.replaceChildren(...rows);
            // Re-init select values
            priorityOrder.forEach(key => {
                const meta = contextMeta[key];
                const sel = document.getElementById(`cin-ctx-${key}`);
                if (sel) {
                    const currentValue = ctx[key] !== undefined ? ctx[key] : meta.defaultVal;
                    if (currentValue === null && !meta.noInherit) {
                        sel.value = '__inherit__';
                    } else if (currentValue !== null) {
                        sel.value = currentValue;
                    }
                }
            });
            // Wire change events
            priorityOrder.forEach(key => {
                const sel = document.getElementById(`cin-ctx-${key}`);
                sel?.addEventListener('change', () => {
                    const ws = getWorkingState();
                    ws.header = ws.header || {};
                    ws.header.contextHeaders = ws.header.contextHeaders || {};
                    const val = sel.value;
                    if (val === '__inherit__') {
                        ws.header.contextHeaders[key] = null;
                    } else {
                        ws.header.contextHeaders[key] = val;
                    }
                    saveWorkingState();
                });
            });
        };

        const contextContainer = el(
            'div',
            {
                id: 'cin-ctx-container',
                class: 'ctx-container',
                style: ctx.enabled ? '' : 'display:none',
            },
            [
                // Fallback row at top
                el('div', { class: 'ctx-fallback-section' }, [
                    el('div', { class: 'ctx-section-label' }, 'Fallback'),
                    defaultRow,
                ]),
                // Priority section below
                el('div', { class: 'ctx-priority-section' }, [
                    el('div', { class: 'ctx-priority-header' }, [
                        el('span', { class: 'ctx-priority-title' }, 'Priority Order'),
                        el(
                            'span',
                            { class: 'ctx-priority-subtitle' },
                            'Drag to reorder • First match wins'
                        ),
                        el(
                            'button',
                            {
                                type: 'button',
                                class: 'btn btn-small ctx-reset-priority',
                                title: 'Reset priority order to default',
                            },
                            [el('i', { class: 'fas fa-undo' }), ' Reset']
                        ),
                    ]),
                    sortableContainer,
                ]),
            ]
        );

        // Wire reset priority button
        contextContainer.querySelector('.ctx-reset-priority')?.addEventListener('click', () => {
            priorityOrder = [...defaultPriorityOrder];
            rebuildSortableRows();
            // Save to working state
            const ws = getWorkingState();
            ws.header = ws.header || {};
            ws.header.contextHeaders = ws.header.contextHeaders || {};
            ws.header.contextHeaders.priorityOrder = [...priorityOrder];
            saveWorkingState();
            // Mark as unsaved changes
            markCinemaSettingsDirty();
        });

        // Typography section header
        const typoHeader = el(
            'div',
            { class: 'cinema-section-header', style: 'margin-top: 16px;' },
            'Typography'
        );

        // Font Family row
        const rowFont = el('div', { class: 'form-row' }, [
            el('label', { for: 'cin-h-font' }, 'Font Family'),
            el('div', { class: 'select-wrap has-caret' }, [
                el('select', { id: 'cin-h-font' }, [
                    el('option', { value: 'system' }, 'System (Default)'),
                    el('option', { value: 'cinematic' }, 'Cinematic (Bebas Neue)'),
                    el('option', { value: 'classic' }, 'Classic (Playfair)'),
                    el('option', { value: 'modern' }, 'Modern (Montserrat)'),
                    el('option', { value: 'elegant' }, 'Elegant (Cormorant)'),
                    el('option', { value: 'marquee' }, 'Marquee (Broadway)'),
                    el('option', { value: 'retro' }, 'Retro (Press Start)'),
                    el('option', { value: 'neon' }, 'Neon (Tilt Neon)'),
                    el('option', { value: 'scifi' }, 'Sci-Fi (Space Grotesk)'),
                    el('option', { value: 'poster' }, 'Poster (Oswald)'),
                    el('option', { value: 'epic' }, 'Epic (Cinzel)'),
                    el('option', { value: 'bold' }, 'Bold (Lilita One)'),
                ]),
                el('span', { class: 'select-caret', 'aria-hidden': 'true' }, '▾'),
            ]),
        ]);

        // Font Size row - with slider and percentage on same line
        const rowSize = el('div', { class: 'form-row' }, [
            el('label', { for: 'cin-h-size' }, 'Font Size'),
            el('div', { class: 'slider-row' }, [
                el('div', { class: 'modern-slider' }, [
                    el('input', {
                        type: 'range',
                        id: 'cin-h-size',
                        min: '50',
                        max: '200',
                        step: '5',
                        value: String(typo.fontSize || 100),
                    }),
                    el('div', { class: 'slider-bar' }, [el('div', { class: 'fill' })]),
                ]),
                el(
                    'div',
                    {
                        class: 'slider-percentage',
                        'data-target': 'cinema.header.typography.fontSize',
                    },
                    `${typo.fontSize || 100}%`
                ),
            ]),
        ]);

        // Color picker container
        const rowColor = el('div', { id: 'cin-h-color-picker', class: 'form-row' });

        // Ton-sur-ton checkbox row
        const rowTonSurTon = el('div', { class: 'form-row', id: 'cin-h-tst-row' }, [
            el('label', { for: 'cin-h-tst' }, 'Auto Color'),
            el('label', { class: 'checkbox', for: 'cin-h-tst' }, [
                el('input', { type: 'checkbox', id: 'cin-h-tst' }),
                el('span', { class: 'checkmark' }),
                el('span', {}, 'Ton-sur-ton'),
            ]),
        ]);

        // Ton-sur-ton intensity slider row
        const rowTstIntensity = el('div', { class: 'form-row', id: 'cin-h-tst-intensity-row' }, [
            el('label', { for: 'cin-h-tst-intensity' }, 'Color Intensity'),
            el('div', { class: 'slider-row' }, [
                el('div', { class: 'modern-slider' }, [
                    el('input', {
                        type: 'range',
                        id: 'cin-h-tst-intensity',
                        min: '10',
                        max: '100',
                        step: '5',
                        value: String(typo.tonSurTonIntensity || 45),
                    }),
                    el('div', { class: 'slider-bar' }, [el('div', { class: 'fill' })]),
                ]),
                el(
                    'div',
                    {
                        class: 'slider-percentage',
                        'data-target': 'cinema.header.typography.tonSurTonIntensity',
                    },
                    `${typo.tonSurTonIntensity || 45}%`
                ),
            ]),
        ]);

        // Shadow row
        const rowShadow = el('div', { class: 'form-row' }, [
            el('label', { for: 'cin-h-shadow' }, 'Shadow'),
            el('div', { class: 'select-wrap has-caret' }, [
                el('select', { id: 'cin-h-shadow' }, [
                    el('option', { value: 'none' }, 'None'),
                    el('option', { value: 'subtle' }, 'Subtle Shadow'),
                    el('option', { value: 'dramatic' }, 'Dramatic Shadow'),
                    el('option', { value: 'neon' }, 'Neon Glow'),
                    el('option', { value: 'glow' }, 'Soft Glow'),
                ]),
                el('span', { class: 'select-caret', 'aria-hidden': 'true' }, '▾'),
            ]),
        ]);

        // Text Effect row (Issue #126 - Enhanced Header Text Effects)
        const rowTextEffect = el('div', { class: 'form-row' }, [
            el('label', { for: 'cin-h-texteffect' }, 'Text Effect'),
            el('div', { class: 'select-wrap has-caret' }, [
                el('select', { id: 'cin-h-texteffect' }, [
                    el('optgroup', { label: 'Basic' }, [el('option', { value: 'none' }, 'None')]),
                    el('optgroup', { label: 'Gradient Fills' }, [
                        el('option', { value: 'gradient' }, 'Gradient'),
                        el('option', { value: 'gradient-rainbow' }, 'Rainbow Gradient'),
                        el('option', { value: 'gradient-gold' }, 'Gold Gradient'),
                        el('option', { value: 'gradient-silver' }, 'Silver Gradient'),
                    ]),
                    el('optgroup', { label: 'Outline/Stroke' }, [
                        el('option', { value: 'outline' }, 'Outline'),
                        el('option', { value: 'outline-thick' }, 'Thick Outline'),
                        el('option', { value: 'outline-double' }, 'Double Outline'),
                    ]),
                    el('optgroup', { label: 'Metallic' }, [
                        el('option', { value: 'metallic' }, 'Metallic'),
                        el('option', { value: 'chrome' }, 'Chrome'),
                        el('option', { value: 'gold-metallic' }, 'Gold Metallic'),
                    ]),
                    el('optgroup', { label: 'Vintage/Retro' }, [
                        el('option', { value: 'vintage' }, 'Vintage'),
                        el('option', { value: 'retro' }, 'Retro'),
                    ]),
                    el('optgroup', { label: 'Special Effects' }, [
                        el('option', { value: 'fire' }, 'Fire'),
                        el('option', { value: 'ice' }, 'Ice'),
                    ]),
                    el('optgroup', { label: 'Animations' }, [
                        el('option', { value: 'pulse' }, 'Pulse'),
                        el('option', { value: 'marquee' }, 'Marquee Scroll'),
                    ]),
                ]),
                el('span', { class: 'select-caret', 'aria-hidden': 'true' }, '▾'),
            ]),
        ]);

        // Entrance Animation row (Issue #126 - Enhanced Header Text Effects)
        const rowEntranceAnim = el('div', { class: 'form-row' }, [
            el('label', { for: 'cin-h-entrance' }, 'Entrance Animation'),
            el('div', { class: 'select-wrap has-caret' }, [
                el('select', { id: 'cin-h-entrance' }, [
                    el('option', { value: 'none' }, 'None'),
                    el('optgroup', { label: 'Text Reveals' }, [
                        el('option', { value: 'typewriter' }, 'Typewriter'),
                        el('option', { value: 'fade-words' }, 'Fade Word by Word'),
                        el('option', { value: 'letter-spread' }, 'Letter Spread'),
                    ]),
                    el('optgroup', { label: 'Slide In' }, [
                        el('option', { value: 'slide-left' }, 'Slide from Left'),
                        el('option', { value: 'slide-right' }, 'Slide from Right'),
                        el('option', { value: 'slide-top' }, 'Slide from Top'),
                        el('option', { value: 'slide-bottom' }, 'Slide from Bottom'),
                    ]),
                    el('optgroup', { label: 'Scale/Zoom' }, [
                        el('option', { value: 'zoom' }, 'Zoom In'),
                        el('option', { value: 'zoom-bounce' }, 'Zoom Bounce'),
                        el('option', { value: 'drop' }, 'Drop In'),
                    ]),
                    el('optgroup', { label: 'Focus' }, [
                        el('option', { value: 'blur-focus' }, 'Blur to Focus'),
                        el('option', { value: 'fade' }, 'Fade In'),
                        el('option', { value: 'cinematic' }, 'Cinematic Reveal'),
                    ]),
                    el('optgroup', { label: '3D Effects' }, [
                        el('option', { value: 'rotate-3d' }, 'Rotate 3D'),
                        el('option', { value: 'flip' }, 'Flip In'),
                    ]),
                    el('optgroup', { label: 'Continuous' }, [
                        el('option', { value: 'float' }, 'Floating'),
                    ]),
                ]),
                el('span', { class: 'select-caret', 'aria-hidden': 'true' }, '▾'),
            ]),
        ]);

        // Decoration row (only shown when textEffect has no animation)
        const rowDecoration = el('div', { class: 'form-row', id: 'cin-h-decoration-row' }, [
            el('label', { for: 'cin-h-decoration' }, 'Decoration'),
            el('div', { class: 'select-wrap has-caret' }, [
                el('select', { id: 'cin-h-decoration' }, [
                    el('option', { value: 'none' }, 'None'),
                    el('option', { value: 'frame' }, 'Frame'),
                    el('option', { value: 'underline' }, 'Underline'),
                ]),
                el('span', { class: 'select-caret', 'aria-hidden': 'true' }, '▾'),
            ]),
        ]);

        const grid = el('div', { class: 'form-grid' }, [
            rowText,
            contextHeaderToggle,
            contextContainer,
            typoHeader,
            rowFont,
            rowSize,
            rowTonSurTon,
            rowTstIntensity,
            rowColor,
            rowShadow,
            rowTextEffect,
            rowEntranceAnim,
            rowDecoration,
        ]);
        container.replaceChildren(grid);

        // Initialize values
        $('#cin-h-font').value = typo.fontFamily || 'cinematic';
        $('#cin-h-shadow').value = typo.shadow || 'subtle';
        $('#cin-h-texteffect').value = typo.textEffect || 'none';
        $('#cin-h-entrance').value = typo.entranceAnimation || 'none';
        $('#cin-h-decoration').value = typo.decoration || 'none';
        $('#cin-h-tst').checked = typo.tonSurTon || false;
        $('#cin-h-tst-intensity').value = typo.tonSurTonIntensity || 45;

        // Initialize default context header dropdown
        const defaultSel = document.getElementById('cin-ctx-default');
        if (defaultSel) {
            const defaultVal =
                ctx.default !== undefined ? ctx.default : contextMeta.default.defaultVal;
            defaultSel.value = defaultVal;
            defaultSel.addEventListener('change', () => {
                const ws = getWorkingState();
                ws.header = ws.header || {};
                ws.header.contextHeaders = ws.header.contextHeaders || {};
                ws.header.contextHeaders.default = defaultSel.value;
                saveWorkingState();
            });
        }

        // Build and initialize sortable context rows
        rebuildSortableRows();

        // Wire drag-and-drop for priority reordering
        let draggedEl = null;
        sortableContainer.addEventListener('dragstart', e => {
            const row = e.target.closest('.ctx-sortable');
            if (!row) return;
            draggedEl = row;
            row.classList.add('ctx-dragging');
            e.dataTransfer.effectAllowed = 'move';
        });
        sortableContainer.addEventListener('dragend', _e => {
            if (draggedEl) {
                draggedEl.classList.remove('ctx-dragging');
                draggedEl = null;
            }
        });
        sortableContainer.addEventListener('dragover', e => {
            e.preventDefault();
            const row = e.target.closest('.ctx-sortable');
            if (!row || row === draggedEl) return;
            const rect = row.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            if (e.clientY < midY) {
                row.parentNode.insertBefore(draggedEl, row);
            } else {
                row.parentNode.insertBefore(draggedEl, row.nextSibling);
            }
        });
        sortableContainer.addEventListener('drop', e => {
            e.preventDefault();
            // Update priority order from DOM
            const rows = sortableContainer.querySelectorAll('.ctx-sortable');
            priorityOrder = Array.from(rows).map(r => r.getAttribute('data-ctx-key'));
            // Update priority badges
            rows.forEach((row, idx) => {
                const badge = row.querySelector('.ctx-priority-badge');
                if (badge) badge.textContent = `#${idx + 1}`;
            });
            // Save to working state
            const ws = getWorkingState();
            ws.header = ws.header || {};
            ws.header.contextHeaders = ws.header.contextHeaders || {};
            ws.header.contextHeaders.priorityOrder = [...priorityOrder];
            saveWorkingState();
            // Mark as unsaved changes
            markCinemaSettingsDirty();
        });
        // Make rows draggable
        sortableContainer.querySelectorAll('.ctx-sortable').forEach(row => {
            row.setAttribute('draggable', 'true');
        });

        // Wire context headers enable toggle
        const ctxEnabledCheckbox = document.getElementById('cin-ctx-enabled');
        const ctxContainer = document.getElementById('cin-ctx-container');
        ctxEnabledCheckbox?.addEventListener('change', () => {
            if (ctxContainer) {
                ctxContainer.style.display = ctxEnabledCheckbox.checked ? '' : 'none';
            }
            // Save to working state
            const ws = getWorkingState();
            ws.header = ws.header || {};
            ws.header.contextHeaders = ws.header.contextHeaders || {};
            ws.header.contextHeaders.enabled = ctxEnabledCheckbox.checked;
            saveWorkingState();
        });

        // Wire decoration visibility based on textEffect and entranceAnimation
        const decorationRow = document.getElementById('cin-h-decoration-row');
        const textEffectSelect = document.getElementById('cin-h-texteffect');
        const entranceSelect = document.getElementById('cin-h-entrance');
        const decorationSelect = document.getElementById('cin-h-decoration');
        const shadowRow = document.getElementById('cin-h-shadow')?.closest('.form-row');

        const syncDecorationVisibility = () => {
            // Hide decoration ONLY when using animation-based textEffects (pulse, marquee)
            const animEffects = ['pulse', 'marquee'];
            const isAnimEffect = animEffects.includes(textEffectSelect?.value);

            if (decorationRow) decorationRow.style.display = isAnimEffect ? 'none' : '';
        };

        const syncShadowVisibility = () => {
            // Shadow is always visible for all decorations
            if (shadowRow) shadowRow.style.display = '';
        };

        textEffectSelect?.addEventListener('change', () => {
            syncDecorationVisibility();
            syncShadowVisibility();
        });
        entranceSelect?.addEventListener('change', () => {
            syncDecorationVisibility();
        });
        decorationSelect?.addEventListener('change', syncShadowVisibility);
        syncDecorationVisibility();
        syncShadowVisibility();

        // Initialize header text preset
        (function () {
            const sel = document.getElementById('cin-h-presets');
            const presets = getAllTextPresets();
            const desired =
                wsH.header?.text && presets.includes(wsH.header.text)
                    ? wsH.header.text
                    : presets.includes(h.text)
                      ? h.text
                      : presets[0];
            populateSimpleSelect(sel, presets, desired);
        })();

        // Wire modern slider for font size
        wireModernSliders();

        // Wire color picker
        const colorContainer = document.getElementById('cin-h-color-picker');
        if (colorContainer && window.createColorPicker) {
            const hiddenInput = document.createElement('input');
            hiddenInput.type = 'hidden';
            hiddenInput.id = 'cin-h-color';
            hiddenInput.value = typo.color || '#ffffff';

            const picker = window.createColorPicker({
                label: 'Text Color',
                color: typo.color || '#ffffff',
                defaultColor: '#ffffff',
                presets: CINEMA_COLOR_PRESETS,
                onColorChange: color => {
                    hiddenInput.value = color;
                },
                messageType: 'CINEMA_HEADER_COLOR_UPDATE',
                refreshIframe: false,
                iframeId: 'display-preview-frame',
            });

            colorContainer.innerHTML = '';
            colorContainer.appendChild(hiddenInput);
            colorContainer.appendChild(picker);

            // Wire ton-sur-ton toggle for header
            const tstCheckbox = document.getElementById('cin-h-tst');
            const tstIntensityRow = document.getElementById('cin-h-tst-intensity-row');
            const syncTstVisibility = () => {
                const isTst = tstCheckbox?.checked;
                colorContainer.style.display = isTst ? 'none' : '';
                if (tstIntensityRow) tstIntensityRow.style.display = isTst ? '' : 'none';
            };
            tstCheckbox?.addEventListener('change', syncTstVisibility);
            syncTstVisibility();
        }

        // Wire Manage button for header texts (only manages user presets, not system presets)
        // User presets are shared between header and footer
        document.getElementById('cin-h-manage')?.addEventListener('click', () =>
            openManageModal({
                title: 'Manage Custom Texts',
                getItems: () => userTextPresets,
                setItems: next => {
                    userTextPresets = Array.isArray(next) ? [...next] : [];
                    const ws = getWorkingState();
                    // Save combined list for persistence (system presets will be filtered on load)
                    const combined = [...SYSTEM_TEXT_PRESETS, ...userTextPresets];
                    ws.presets.headerTexts = combined;
                    ws.presets.footerTexts = combined;
                    saveWorkingState();
                    // Also refresh footer dropdown
                    const footerSel = document.getElementById('cin-f-presets');
                    if (footerSel) {
                        const currentVal = footerSel.value;
                        populateSimpleSelect(footerSel, getAllTextPresets(), currentVal);
                    }
                },
                selectEl: document.getElementById('cin-h-presets'),
                contextLabel: 'Custom text',
                placeholder: 'Type custom text…',
                systemPresets: SYSTEM_TEXT_PRESETS,
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
            } catch (e) {
                // ignore preview update failure
                void e;
            }
        });
    }

    function mountFooter(container, cfg) {
        const c = cfg.cinema || {};
        const f = c.footer || {
            enabled: true,
            type: 'metadata',
            marqueeText: 'Feature Presentation',
            typography: {},
        };
        const typo = f.typography || {};
        const wsF = getWorkingState();
        // User presets are already loaded in mountHeader and shared with footer
        // No need to reload here - userTextPresets is already populated

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
            // footer toggle mount failure ignored (card not yet in DOM)
            void 0;
        }

        // Footer type row with Marquee checkbox for tagline
        const ctrlType = el('div', { class: 'form-row' }, [
            el('label', { for: 'cin-f-type' }, 'Footer type'),
            el('div', { class: 'cinema-inline', style: 'gap: 12px;' }, [
                el('div', { class: 'select-wrap has-caret' }, [
                    el('select', { id: 'cin-f-type' }, [
                        el('option', { value: 'marquee' }, 'Marquee Text'),
                        el('option', { value: 'metadata' }, 'Metadata & Specs'),
                        el('option', { value: 'tagline' }, 'Movie Tagline'),
                    ]),
                    el('span', { class: 'select-caret', 'aria-hidden': 'true' }, '▾'),
                ]),
                el(
                    'label',
                    {
                        class: 'checkbox',
                        for: 'cin-f-tagline-marquee',
                        id: 'cin-f-tagline-marquee-wrap',
                        style: 'display: none;',
                    },
                    [
                        el('input', {
                            type: 'checkbox',
                            id: 'cin-f-tagline-marquee',
                            checked: f.taglineMarquee ? 'checked' : null,
                        }),
                        el('span', { class: 'checkmark' }),
                        el('span', {}, 'Marquee'),
                    ]
                ),
            ]),
        ]);

        // === Marquee Block ===
        const mRowText = el('div', { class: 'form-row', id: 'cin-f-text-row' }, [
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
        const marqueeBlock = el('div', { id: 'cin-f-marquee', class: 'cin-footer-col' }, [
            mRowText,
        ]);

        // === Tagline Block (info text only, checkbox moved to type row) ===
        const taglineBlock = el('div', { id: 'cin-f-tagline', class: 'cin-footer-col' }, [
            el(
                'p',
                { class: 'help-text', style: 'margin: 8px 0; color: var(--color-text-secondary);' },
                'Displays the movie/series tagline from metadata.'
            ),
        ]);

        // === Typography Block (for marquee and tagline) ===
        const typoHeader = el(
            'div',
            { class: 'cinema-section-header', style: 'margin-top: 12px;' },
            'Typography'
        );

        const rowFont = el('div', { class: 'form-row' }, [
            el('label', { for: 'cin-f-font' }, 'Font Family'),
            el('div', { class: 'select-wrap has-caret' }, [
                el('select', { id: 'cin-f-font' }, [
                    el('option', { value: 'system' }, 'System (Default)'),
                    el('option', { value: 'cinematic' }, 'Cinematic (Bebas Neue)'),
                    el('option', { value: 'classic' }, 'Classic (Playfair)'),
                    el('option', { value: 'modern' }, 'Modern (Montserrat)'),
                    el('option', { value: 'elegant' }, 'Elegant (Cormorant)'),
                    el('option', { value: 'marquee' }, 'Marquee (Broadway)'),
                    el('option', { value: 'retro' }, 'Retro (Press Start)'),
                    el('option', { value: 'neon' }, 'Neon (Tilt Neon)'),
                    el('option', { value: 'scifi' }, 'Sci-Fi (Space Grotesk)'),
                    el('option', { value: 'poster' }, 'Poster (Oswald)'),
                    el('option', { value: 'epic' }, 'Epic (Cinzel)'),
                    el('option', { value: 'bold' }, 'Bold (Lilita One)'),
                ]),
                el('span', { class: 'select-caret', 'aria-hidden': 'true' }, '▾'),
            ]),
        ]);

        const rowSize = el('div', { class: 'form-row' }, [
            el('label', { for: 'cin-f-size' }, 'Font Size'),
            el('div', { class: 'slider-row' }, [
                el('div', { class: 'modern-slider' }, [
                    el('input', {
                        type: 'range',
                        id: 'cin-f-size',
                        min: '50',
                        max: '200',
                        step: '5',
                        value: String(typo.fontSize || 100),
                    }),
                    el('div', { class: 'slider-bar' }, [el('div', { class: 'fill' })]),
                ]),
                el(
                    'div',
                    {
                        class: 'slider-percentage',
                        'data-target': 'cinema.footer.typography.fontSize',
                    },
                    `${typo.fontSize || 100}%`
                ),
            ]),
        ]);

        const rowColor = el('div', { id: 'cin-f-color-picker', class: 'form-row' });

        // Ton-sur-ton checkbox row for footer
        const rowTonSurTon = el('div', { class: 'form-row', id: 'cin-f-tst-row' }, [
            el('label', { for: 'cin-f-tst' }, 'Auto Color'),
            el('label', { class: 'checkbox', for: 'cin-f-tst' }, [
                el('input', { type: 'checkbox', id: 'cin-f-tst' }),
                el('span', { class: 'checkmark' }),
                el('span', {}, 'Ton-sur-ton'),
            ]),
        ]);

        // Ton-sur-ton intensity slider row for footer
        const rowTstIntensity = el('div', { class: 'form-row', id: 'cin-f-tst-intensity-row' }, [
            el('label', { for: 'cin-f-tst-intensity' }, 'Color Intensity'),
            el('div', { class: 'slider-row' }, [
                el('div', { class: 'modern-slider' }, [
                    el('input', {
                        type: 'range',
                        id: 'cin-f-tst-intensity',
                        min: '10',
                        max: '100',
                        step: '5',
                        value: String(typo.tonSurTonIntensity || 45),
                    }),
                    el('div', { class: 'slider-bar' }, [el('div', { class: 'fill' })]),
                ]),
                el(
                    'div',
                    {
                        class: 'slider-percentage',
                        'data-target': 'cinema.footer.typography.tonSurTonIntensity',
                    },
                    `${typo.tonSurTonIntensity || 45}%`
                ),
            ]),
        ]);

        const rowShadow = el('div', { class: 'form-row' }, [
            el('label', { for: 'cin-f-shadow' }, 'Text Shadow'),
            el('div', { class: 'select-wrap has-caret' }, [
                el('select', { id: 'cin-f-shadow' }, [
                    el('option', { value: 'none' }, 'None'),
                    el('option', { value: 'subtle' }, 'Subtle'),
                    el('option', { value: 'dramatic' }, 'Dramatic'),
                ]),
                el('span', { class: 'select-caret', 'aria-hidden': 'true' }, '▾'),
            ]),
        ]);

        const typoBlock = el('div', { id: 'cin-f-typo', class: 'cin-footer-col' }, [
            typoHeader,
            rowFont,
            rowSize,
            rowTonSurTon,
            rowColor,
            rowShadow,
        ]);

        // Compose layout - flat grid like Header for consistent 2-column layout
        const grid = el('div', { class: 'form-grid' }, [
            ctrlType,
            mRowText,
            typoHeader,
            rowFont,
            rowSize,
            rowTonSurTon,
            rowTstIntensity,
            rowColor,
            rowShadow,
        ]);

        // Keep the blocks for show/hide logic but inject grid
        marqueeBlock.replaceChildren(); // Clear - mRowText moved to grid
        taglineBlock.style.display = 'none'; // Hidden by default
        typoBlock.replaceChildren(); // Clear - elements moved to grid

        container.replaceChildren(grid, marqueeBlock, taglineBlock, typoBlock);

        // Initialize values
        $('#cin-f-type').value = f.type || 'metadata';
        $('#cin-f-font').value = typo.fontFamily || 'system';
        $('#cin-f-shadow').value = typo.shadow || 'none';
        $('#cin-f-tst').checked = typo.tonSurTon || false;
        $('#cin-f-tst-intensity').value = typo.tonSurTonIntensity || 45;

        // Initialize footer text preset
        const savedMarqueeText = f.marqueeText;
        (function () {
            const sel = document.getElementById('cin-f-presets');
            const presets = getAllTextPresets();
            const desired =
                wsF.footer?.marqueeText && presets.includes(wsF.footer.marqueeText)
                    ? wsF.footer.marqueeText
                    : presets.includes(savedMarqueeText)
                      ? savedMarqueeText
                      : presets[0];
            populateSimpleSelect(sel, presets, desired);
        })();

        // Wire modern slider
        wireModernSliders();

        // Wire color picker
        const colorContainer = document.getElementById('cin-f-color-picker');
        if (colorContainer && window.createColorPicker) {
            const hiddenInput = document.createElement('input');
            hiddenInput.type = 'hidden';
            hiddenInput.id = 'cin-f-color';
            hiddenInput.value = typo.color || '#cccccc';

            const picker = window.createColorPicker({
                label: 'Text Color',
                color: typo.color || '#cccccc',
                defaultColor: '#cccccc',
                presets: CINEMA_COLOR_PRESETS,
                onColorChange: color => {
                    hiddenInput.value = color;
                },
                messageType: 'CINEMA_FOOTER_COLOR_UPDATE',
                refreshIframe: false,
                iframeId: 'display-preview-frame',
            });

            colorContainer.innerHTML = '';
            colorContainer.appendChild(hiddenInput);
            colorContainer.appendChild(picker);

            // Wire ton-sur-ton toggle for footer
            const tstCheckbox = document.getElementById('cin-f-tst');
            const tstIntensityRow = document.getElementById('cin-f-tst-intensity-row');
            const syncTstVisibility = () => {
                const isTst = tstCheckbox?.checked;
                colorContainer.style.display = isTst ? 'none' : '';
                if (tstIntensityRow) tstIntensityRow.style.display = isTst ? '' : 'none';
            };
            tstCheckbox?.addEventListener('change', syncTstVisibility);
            syncTstVisibility();
        }

        // Wire Manage button for footer texts (only manages user presets, not system presets)
        // User presets are shared between header and footer
        document.getElementById('cin-f-manage')?.addEventListener('click', () =>
            openManageModal({
                title: 'Manage Custom Texts',
                getItems: () => userTextPresets,
                setItems: next => {
                    userTextPresets = Array.isArray(next) ? [...next] : [];
                    const ws = getWorkingState();
                    // Save combined list for persistence (system presets will be filtered on load)
                    const combined = [...SYSTEM_TEXT_PRESETS, ...userTextPresets];
                    ws.presets.headerTexts = combined;
                    ws.presets.footerTexts = combined;
                    saveWorkingState();
                    // Also refresh header dropdown
                    const headerSel = document.getElementById('cin-h-presets');
                    if (headerSel) {
                        const currentVal = headerSel.value;
                        populateSimpleSelect(headerSel, getAllTextPresets(), currentVal);
                    }
                },
                selectEl: document.getElementById('cin-f-presets'),
                contextLabel: 'Custom text',
                placeholder: 'Type custom text…',
                systemPresets: SYSTEM_TEXT_PRESETS,
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
            } catch (e) {
                // ignore preview update failure
                void e;
            }
        });

        // Tagline marquee checkbox change handler
        $('#cin-f-tagline-marquee')?.addEventListener('change', e => {
            const ws = getWorkingState();
            ws.footer = Object.assign({}, ws.footer, {
                taglineMarquee: e.target.checked,
            });
            saveWorkingState();
            try {
                window.__displayPreviewInit && (window.__forcePreviewUpdate?.() || 0);
            } catch (e2) {
                void e2;
            }
        });

        // Sync visibility based on footer type
        const syncBlocks = () => {
            const t = $('#cin-f-type').value;
            const showMarq = t === 'marquee';
            const showTagline = t === 'tagline';
            const showMetadata = t === 'metadata';

            // Hide Footer text row for metadata and tagline type (only marquee needs it)
            const textRow = document.getElementById('cin-f-text-row');
            if (textRow) {
                textRow.style.display = showMarq ? '' : 'none';
            }

            // Show/hide Marquee checkbox (only for tagline type)
            const marqueeWrap = document.getElementById('cin-f-tagline-marquee-wrap');
            if (marqueeWrap) {
                marqueeWrap.style.display = showTagline ? '' : 'none';
            }

            // Typography is always shown (important for all footer types)

            $('#cin-f-marquee').style.display = showMarq ? 'block' : 'none';
            $('#cin-f-tagline').style.display = showTagline ? 'block' : 'none';
            $('#cin-f-typo').style.display = 'block'; // Always show typography

            // Show/hide Metadata Display card based on footer type
            const metadataCard = document.getElementById('cinema-metadata-card');
            if (metadataCard) {
                metadataCard.style.display = showMetadata ? '' : 'none';
            }
        };
        $('#cin-f-type').addEventListener('change', syncBlocks);
        syncBlocks();
    }

    function mountNowPlaying(cfg) {
        const c = cfg.cinema || {};
        const np = c.nowPlaying || { enabled: false };
        // Mount toggle in card title
        try {
            const card = document.getElementById('cinema-now-playing-card');
            const title = card?.querySelector('.card-title');
            if (title && !document.getElementById('cinemaNowPlayingEnabled')) {
                const toggle = el(
                    'label',
                    { class: 'header-toggle', for: 'cinemaNowPlayingEnabled' },
                    [
                        el('input', {
                            type: 'checkbox',
                            id: 'cinemaNowPlayingEnabled',
                            checked: np.enabled ? 'checked' : null,
                        }),
                        el('span', { class: 'ht-switch', 'aria-hidden': 'true' }),
                        el('span', { class: 'ht-text' }, 'Show active sessions'),
                    ]
                );
                title.appendChild(toggle);
            } else {
                const existing = document.getElementById('cinemaNowPlayingEnabled');
                if (existing) existing.checked = !!np.enabled;
            }
        } catch (_) {
            // toggle mount failure ignored
        }
    }

    // === NEW: Mount and initialize enhanced controls (Issue #35) ===
    function mountEnhancedControls(cfg) {
        const c = cfg.cinema || {};

        // Load custom presets from config
        const presets = c.presets || {};
        if (Array.isArray(presets.customStyles) && presets.customStyles.length > 0) {
            customPresets = presets.customStyles;
            saveCustomPresetsToWorkingState();
        }

        // Global Effects controls
        const globalEffects = c.globalEffects || {};
        $('#cinemaColorFilter') &&
            ($('#cinemaColorFilter').value = globalEffects.colorFilter || 'none');
        $('#cinemaContrast') && ($('#cinemaContrast').value = globalEffects.contrast || 100);
        $('#cinemaBrightness') && ($('#cinemaBrightness').value = globalEffects.brightness || 100);
        $('#cinemaHideAllUI') && ($('#cinemaHideAllUI').checked = !!globalEffects.hideAllUI);

        // Global Typography controls
        $('#cinemaGlobalFont') &&
            ($('#cinemaGlobalFont').value = globalEffects.fontFamily || 'cinematic');
        $('#cinemaGlobalTextColorMode') &&
            ($('#cinemaGlobalTextColorMode').value = globalEffects.textColorMode || 'custom');
        $('#cinemaGlobalTextColor') &&
            ($('#cinemaGlobalTextColor').value = globalEffects.textColor || '#ffffff');
        $('#cinemaGlobalTstIntensity') &&
            ($('#cinemaGlobalTstIntensity').value = globalEffects.tonSurTonIntensity || 45);
        $('#cinemaGlobalTextEffect') &&
            ($('#cinemaGlobalTextEffect').value = globalEffects.textEffect || 'subtle');

        // Update visibility based on text color mode
        const isTonSurTon = (globalEffects.textColorMode || 'custom') === 'tonSurTon';
        updateGlobalColorModeVisibility(isTonSurTon);

        // Selected Preset - restore selection
        if ($('#cinemaPresetSelect') && c.selectedPreset) {
            $('#cinemaPresetSelect').value = c.selectedPreset;
        }

        // Background controls
        const bg = c.background || {};
        $('#cinemaBackgroundMode') && ($('#cinemaBackgroundMode').value = bg.mode || 'solid');
        $('#cinemaBackgroundBlur') && ($('#cinemaBackgroundBlur').value = bg.blurAmount || 20);
        $('#cinemaVignette') && ($('#cinemaVignette').value = bg.vignette || 'subtle');

        // Poster controls
        const poster = c.poster || {};
        $('#cinemaPosterStyle') && ($('#cinemaPosterStyle').value = poster.style || 'floating');
        $('#cinemaPosterOverlay') && ($('#cinemaPosterOverlay').value = poster.overlay || 'none');

        // Cinematic Transitions
        const ct = poster.cinematicTransitions || {};
        $('#cinemaTransitionMode') &&
            ($('#cinemaTransitionMode').value = ct.selectionMode || 'random');
        $('#cinemaSingleTransition') &&
            ($('#cinemaSingleTransition').value = ct.singleTransition || 'fade');

        // Show/hide single transition dropdown based on mode
        const singleRow = document.getElementById('singleTransitionRow');
        if (singleRow) {
            singleRow.style.display = ct.selectionMode === 'single' ? '' : 'none';
        }

        // Per-transition preview buttons (tiny play icon per transition)
        const previewTransition = transition => {
            try {
                const frame = document.getElementById('display-preview-frame');
                const previewWin = frame && frame.contentWindow ? frame.contentWindow : null;
                if (!previewWin) return;
                previewWin.postMessage(
                    {
                        type: 'CINEMA_PREVIEW_TRANSITION',
                        transition,
                    },
                    window.location.origin
                );
            } catch (_) {
                /* preview trigger is best-effort */
            }
        };

        const transitionsGrid = document.getElementById('enabledTransitionsGrid');
        if (transitionsGrid && !transitionsGrid.__posterramaPreviewWired) {
            transitionsGrid.__posterramaPreviewWired = true;

            // Ensure each toggle-row gets a small preview button
            transitionsGrid.querySelectorAll('label.toggle-row').forEach(row => {
                const checkbox = row.querySelector('input[type="checkbox"]');
                const transition = checkbox?.value;
                if (!transition) return;
                if (row.querySelector('button.transition-preview-btn')) return;

                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'transition-preview-btn';
                btn.setAttribute('data-transition', transition);
                btn.setAttribute('aria-label', `Preview ${transition}`);
                btn.title = 'Preview this transition in the live display preview';
                btn.textContent = '▶';
                row.appendChild(btn);
            });

            // Delegate clicks to avoid label/checkbox toggling side-effects
            transitionsGrid.addEventListener('click', evt => {
                const btn = evt.target?.closest?.('button.transition-preview-btn');
                if (!btn) return;
                evt.preventDefault();
                evt.stopPropagation();
                const transition = btn.getAttribute('data-transition');
                if (!transition) return;
                previewTransition(transition);
            });
        }

        // Single-transition mode: add a small preview button next to the dropdown
        if (singleRow) {
            const selectWrap = singleRow.querySelector('.select-wrap');
            const selectEl = document.getElementById('cinemaSingleTransition');
            if (selectWrap && selectEl && !singleRow.__posterramaSinglePreviewWired) {
                singleRow.__posterramaSinglePreviewWired = true;
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'transition-preview-btn single-transition-preview-btn';
                btn.setAttribute('aria-label', 'Preview selected single transition');
                btn.title = 'Preview the selected single transition in the live display preview';
                btn.textContent = '▶';
                selectWrap.insertAdjacentElement('afterend', btn);
                btn.addEventListener('click', evt => {
                    evt.preventDefault();
                    evt.stopPropagation();
                    const transition = selectEl.value || 'fade';
                    previewTransition(transition);
                });
            }
        }

        // Set enabled transitions checkboxes
        const enabledList = ct.enabledTransitions || [
            'fade',
            'zoomIn',
            'slideUp',
            'cinematic',
            'lightFlare',
            'shatter',
            'spotlight',
            'unfold',
            'swing',
            'ripple',
            'curtainReveal',
            'filmGate',
            'projectorFlicker',
            'rackFocus',
            'lightSweep',
            'parallaxFloat',
            'dollyIn',
            'splitFlap',
            'smokeFade',
            'lensIris',
        ];
        const checkboxes = document.querySelectorAll(
            '#enabledTransitionsGrid input[type="checkbox"]'
        );
        checkboxes.forEach(cb => {
            cb.checked = enabledList.includes(cb.value);
        });

        $('#cinemaPosterTransition') &&
            ($('#cinemaPosterTransition').value = poster.transitionDuration || 1.5);
        $('#cinemaFrameColorMode') &&
            ($('#cinemaFrameColorMode').value = poster.frameColorMode || 'custom');
        $('#cinemaFrameWidth') && ($('#cinemaFrameWidth').value = poster.frameWidth || 8);

        // Metadata controls
        const meta = c.metadata || {};
        const specs = meta.specs || {};
        $('#cinemaMetadataOpacity') && ($('#cinemaMetadataOpacity').value = meta.opacity || 80);
        // Position is always 'bottom' - dropdown removed
        $('#cinemaShowYear') && ($('#cinemaShowYear').checked = meta.showYear !== false);
        $('#cinemaShowRuntime') && ($('#cinemaShowRuntime').checked = meta.showRuntime !== false);
        $('#cinemaShowRating') && ($('#cinemaShowRating').checked = meta.showRating !== false);
        $('#cinemaShowCertification') &&
            ($('#cinemaShowCertification').checked = !!meta.showCertification);
        $('#cinemaShowGenre') && ($('#cinemaShowGenre').checked = !!meta.showGenre);
        $('#cinemaShowDirector') && ($('#cinemaShowDirector').checked = !!meta.showDirector);
        $('#cinemaShowStudioLogo') && ($('#cinemaShowStudioLogo').checked = !!meta.showStudioLogo);

        // Layout preset
        $('#cinemaMetadataLayout') &&
            ($('#cinemaMetadataLayout').value = meta.layout || 'comfortable');

        // Specs controls
        $('#cinemaShowResolution') &&
            ($('#cinemaShowResolution').checked = specs.showResolution !== false);
        $('#cinemaShowAudio') && ($('#cinemaShowAudio').checked = specs.showAudio !== false);
        $('#cinemaShowHDR') && ($('#cinemaShowHDR').checked = specs.showHDR !== false);
        $('#cinemaShowAspectRatio') &&
            ($('#cinemaShowAspectRatio').checked = !!specs.showAspectRatio);
        $('#cinemaSpecsStyle') && ($('#cinemaSpecsStyle').value = specs.style || 'icons-text');
        $('#cinemaSpecsIconSet') && ($('#cinemaSpecsIconSet').value = specs.iconSet || 'tabler');

        // Promotional controls
        const promo = c.promotional || {};
        $('#cinemaRatingBadge') && ($('#cinemaRatingBadge').checked = !!promo.showRating);
        $('#cinemaWatchProviders') &&
            ($('#cinemaWatchProviders').checked = !!promo.showWatchProviders);
        $('#cinemaAwardsBadge') && ($('#cinemaAwardsBadge').checked = !!promo.showAwardsBadge);

        // Trailer settings
        const trailer = promo.trailer || {};
        $('#cinemaTrailerEnabled') && ($('#cinemaTrailerEnabled').checked = !!trailer.enabled);
        $('#cinemaTrailerDelay') && ($('#cinemaTrailerDelay').value = trailer.delay ?? 5);
        $('#cinemaTrailerMuted') && ($('#cinemaTrailerMuted').checked = trailer.muted !== false);
        $('#cinemaTrailerLoop') && ($('#cinemaTrailerLoop').checked = trailer.loop !== false);
        $('#cinemaTrailerQuality') &&
            ($('#cinemaTrailerQuality').value = trailer.quality || 'default');
        $('#cinemaTrailerAutohide') &&
            ($('#cinemaTrailerAutohide').value = trailer.autohide || 'never');
        $('#cinemaTrailerReshow') && ($('#cinemaTrailerReshow').value = trailer.reshow || 'never');

        // Show/hide re-show row based on autohide value
        const reshowRow = $('#cinemaTrailerReshowRow');
        if (reshowRow) {
            reshowRow.style.display =
                trailer.autohide && trailer.autohide !== 'never' ? '' : 'none';
        }

        // QR Code settings
        const qr = promo.qrCode || {};
        $('#cinemaQREnabled') && ($('#cinemaQREnabled').checked = !!qr.enabled);
        $('#cinemaQRUrlType') && ($('#cinemaQRUrlType').value = qr.urlType || 'trailer');
        $('#cinemaQRUrl') && ($('#cinemaQRUrl').value = qr.url || '');
        $('#cinemaQRPosition') && ($('#cinemaQRPosition').value = qr.position || 'bottomRight');
        $('#cinemaQRSize') && ($('#cinemaQRSize').value = qr.size || 100);

        // Orientation control
        $('#cinemaOrientation') && ($('#cinemaOrientation').value = c.orientation || 'auto');

        // Rotation interval control
        $('#cinemaRotationInterval') &&
            ($('#cinemaRotationInterval').value = c.rotationIntervalMinutes || 0);

        // Initialize color pickers for background, poster, and global effects
        initColorPickers(bg, poster, globalEffects);

        // Wire up modern sliders with fill bar and percentage display
        wireModernSliders();

        // Wire up conditional visibility
        wireConditionalVisibility();

        // Specs icon set: show only when style uses icons
        const specsStyle = $('#cinemaSpecsStyle');
        const iconSetRow = $('#cinemaSpecsIconSetRow');
        if (specsStyle && iconSetRow) {
            const syncIconVisibility = () => {
                const needsIcons =
                    specsStyle.value === 'icons-only' || specsStyle.value === 'icons-text';
                iconSetRow.style.display = needsIcons ? '' : 'none';
            };
            specsStyle.addEventListener('change', syncIconVisibility);
            syncIconVisibility();
        }

        // Trailer: show settings when enabled
        const trailerEnabled = $('#cinemaTrailerEnabled');
        const trailerSettings = $('#cinemaTrailerSettings');
        if (trailerEnabled && trailerSettings) {
            const syncTrailerVisibility = () => {
                trailerSettings.style.display = trailerEnabled.checked ? '' : 'none';
            };
            trailerEnabled.addEventListener('change', syncTrailerVisibility);
            syncTrailerVisibility();
        }

        // Trailer: show sound warning when muted is unchecked
        const trailerMuted = $('#cinemaTrailerMuted');
        const trailerSoundWarning = $('#trailerSoundWarning');
        if (trailerMuted && trailerSoundWarning) {
            const syncSoundWarning = () => {
                trailerSoundWarning.style.display = trailerMuted.checked ? 'none' : '';
            };
            trailerMuted.addEventListener('change', syncSoundWarning);
            syncSoundWarning();
        }

        // Trailer: show re-show row when autohide is not 'never'
        const trailerAutohide = $('#cinemaTrailerAutohide');
        const trailerReshowRow = $('#cinemaTrailerReshowRow');
        if (trailerAutohide && trailerReshowRow) {
            const syncReshowVisibility = () => {
                trailerReshowRow.style.display = trailerAutohide.value !== 'never' ? '' : 'none';
            };
            trailerAutohide.addEventListener('change', syncReshowVisibility);
            syncReshowVisibility();
        }

        // QR Code: show settings when enabled
        const qrEnabled = $('#cinemaQREnabled');
        const qrSettings = $('#cinemaQRSettings');
        const qrUrlType = $('#cinemaQRUrlType');
        const qrCustomUrlRow = $('#cinemaQRCustomUrlRow');
        const qrUrlInput = $('#cinemaQRUrl');
        const qrUrlError = $('#cinemaQRUrlError');

        if (qrEnabled && qrSettings) {
            const syncQRVisibility = () => {
                qrSettings.style.display = qrEnabled.checked ? '' : 'none';
            };
            qrEnabled.addEventListener('change', syncQRVisibility);
            syncQRVisibility();
        }

        // QR URL Type: show custom URL input when 'custom' is selected
        if (qrUrlType && qrCustomUrlRow) {
            const syncCustomUrlVisibility = () => {
                const isCustom = qrUrlType.value === 'custom';
                qrCustomUrlRow.style.display = isCustom ? '' : 'none';
                // Clear error when switching away from custom
                if (!isCustom && qrUrlError) {
                    qrUrlError.style.display = 'none';
                }
            };
            qrUrlType.addEventListener('change', syncCustomUrlVisibility);
            syncCustomUrlVisibility();
        }

        // QR Custom URL: validate URL format
        if (qrUrlInput && qrUrlError) {
            const validateQRUrl = () => {
                const value = qrUrlInput.value.trim();
                if (!value) {
                    qrUrlError.style.display = 'none';
                    return true; // Empty is valid (will fallback)
                }
                try {
                    const url = new URL(value);
                    const isValid = url.protocol === 'http:' || url.protocol === 'https:';
                    qrUrlError.style.display = isValid ? 'none' : '';
                    return isValid;
                } catch {
                    qrUrlError.style.display = '';
                    return false;
                }
            };
            qrUrlInput.addEventListener('input', validateQRUrl);
            qrUrlInput.addEventListener('blur', validateQRUrl);
        }

        // Announcement: show settings when enabled
        const annEnabled = $('#cinemaAnnouncementEnabled');
        const annSettings = $('#cinemaAnnouncementSettings');
        if (annEnabled && annSettings) {
            const syncAnnVisibility = () => {
                annSettings.style.display = annEnabled.checked ? '' : 'none';
            };
            annEnabled.addEventListener('change', syncAnnVisibility);
            syncAnnVisibility();
        }
    }

    // Color presets for cinema (cinema-themed colors)
    const CINEMA_COLOR_PRESETS = [
        { name: 'White', color: '#ffffff', gradient: 'linear-gradient(135deg, #ffffff, #f0f0f0)' },
        { name: 'Gold', color: '#ffd700', gradient: 'linear-gradient(135deg, #ffd700, #ffaa00)' },
        { name: 'Silver', color: '#c0c0c0', gradient: 'linear-gradient(135deg, #c0c0c0, #a0a0a0)' },
        { name: 'Red', color: '#ff3333', gradient: 'linear-gradient(135deg, #ff3333, #cc0000)' },
        { name: 'Blue', color: '#3399ff', gradient: 'linear-gradient(135deg, #3399ff, #0066cc)' },
        { name: 'Black', color: '#000000', gradient: 'linear-gradient(135deg, #333333, #000000)' },
        {
            name: 'Dark Blue',
            color: '#1a1a2e',
            gradient: 'linear-gradient(135deg, #1a1a2e, #0a0a15)',
        },
        {
            name: 'Dark Gray',
            color: '#333333',
            gradient: 'linear-gradient(135deg, #333333, #1a1a1a)',
        },
    ];

    function initColorPickers(bg, poster, globalEffects) {
        // Check if createColorPicker is available (from ui-components.js via admin.js)
        if (typeof window.createColorPicker !== 'function') {
            // Retry after a short delay - admin.js module may still be loading
            setTimeout(() => {
                if (typeof window.createColorPicker === 'function') {
                    initColorPickers(bg, poster, globalEffects);
                } else {
                    console.warn(
                        'createColorPicker not available after retry, using fallback color inputs'
                    );
                    initFallbackColorPickers(bg, poster, globalEffects);
                }
            }, 500);
            return;
        }

        // Tint Color picker (Global Effects)
        const tintColorContainer = document.getElementById('cinema-tint-color-picker-container');
        if (tintColorContainer) {
            const hiddenInput = document.createElement('input');
            hiddenInput.type = 'hidden';
            hiddenInput.id = 'cinemaTintColor';
            hiddenInput.value = (globalEffects && globalEffects.tintColor) || '#ff6b00';

            const picker = window.createColorPicker({
                label: 'Tint Color',
                color: (globalEffects && globalEffects.tintColor) || '#ff6b00',
                defaultColor: '#ff6b00',
                presets: CINEMA_COLOR_PRESETS,
                onColorChange: color => {
                    hiddenInput.value = color;
                },
                messageType: 'CINEMA_TINT_COLOR_UPDATE',
                refreshIframe: false,
                iframeId: 'display-preview-frame',
            });

            tintColorContainer.innerHTML = '';
            tintColorContainer.appendChild(hiddenInput);
            tintColorContainer.appendChild(picker);
        }

        // Background Color picker
        const bgColorContainer = document.getElementById(
            'cinema-background-color-picker-container'
        );
        if (bgColorContainer) {
            const hiddenInput = document.createElement('input');
            hiddenInput.type = 'hidden';
            hiddenInput.id = 'cinemaBackgroundColor';
            hiddenInput.value = bg.solidColor || '#000000';

            const picker = window.createColorPicker({
                label: 'Background Color',
                color: bg.solidColor || '#000000',
                defaultColor: '#000000',
                presets: CINEMA_COLOR_PRESETS,
                onColorChange: color => {
                    hiddenInput.value = color;
                },
                messageType: 'CINEMA_BACKGROUND_COLOR_UPDATE',
                refreshIframe: false,
                iframeId: 'display-preview-frame',
            });

            bgColorContainer.innerHTML = '';
            bgColorContainer.appendChild(hiddenInput);
            bgColorContainer.appendChild(picker);
        }

        // Frame Color picker
        const frameColorContainer = document.getElementById('cinema-frame-color-picker-container');
        if (frameColorContainer) {
            const hiddenInput = document.createElement('input');
            hiddenInput.type = 'hidden';
            hiddenInput.id = 'cinemaFrameColor';
            hiddenInput.value = poster.frameColor || '#333333';

            const picker = window.createColorPicker({
                label: 'Frame Color',
                color: poster.frameColor || '#333333',
                defaultColor: '#333333',
                presets: CINEMA_COLOR_PRESETS,
                onColorChange: color => {
                    hiddenInput.value = color;
                },
                messageType: 'CINEMA_FRAME_COLOR_UPDATE',
                refreshIframe: false,
                iframeId: 'display-preview-frame',
            });

            frameColorContainer.innerHTML = '';
            frameColorContainer.appendChild(hiddenInput);
            frameColorContainer.appendChild(picker);
        }

        // Global Text Color picker
        const globalTextColorContainer = document.getElementById(
            'cinema-global-text-color-picker-container'
        );
        if (globalTextColorContainer) {
            const hiddenInput = document.createElement('input');
            hiddenInput.type = 'hidden';
            hiddenInput.id = 'cinemaGlobalTextColor';
            hiddenInput.value = (globalEffects && globalEffects.textColor) || '#ffffff';

            const picker = window.createColorPicker({
                label: 'Text Color',
                color: (globalEffects && globalEffects.textColor) || '#ffffff',
                defaultColor: '#ffffff',
                presets: CINEMA_COLOR_PRESETS,
                onColorChange: color => {
                    hiddenInput.value = color;
                    // Sync to header and footer color inputs
                    const headerColorInput = $('#cin-h-color');
                    const footerColorInput = $('#cin-f-color');
                    if (headerColorInput) headerColorInput.value = color;
                    if (footerColorInput) footerColorInput.value = color;
                },
                messageType: 'CINEMA_GLOBAL_TEXT_COLOR_UPDATE',
                refreshIframe: false,
                iframeId: 'display-preview-frame',
            });

            globalTextColorContainer.innerHTML = '';
            globalTextColorContainer.appendChild(hiddenInput);
            globalTextColorContainer.appendChild(picker);
        }
    }

    // Fallback color pickers when createColorPicker is not available
    function initFallbackColorPickers(bg, poster, globalEffects) {
        const createSimpleColorPicker = (containerId, inputId, label, defaultColor) => {
            const container = document.getElementById(containerId);
            if (!container) return;

            container.innerHTML = `
                <div class="form-row">
                    <label for="${inputId}">${label}</label>
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <input type="color" id="${inputId}" value="${defaultColor}" 
                               style="width: 48px; height: 48px; border: none; border-radius: 50%; cursor: pointer; padding: 0;" />
                        <span id="${inputId}Hex" style="font-family: monospace; color: var(--color-text-muted);">${defaultColor.toUpperCase()}</span>
                    </div>
                </div>
            `;

            const input = document.getElementById(inputId);
            const hex = document.getElementById(`${inputId}Hex`);
            if (input && hex) {
                input.addEventListener('input', () => {
                    hex.textContent = input.value.toUpperCase();
                });
            }
        };

        createSimpleColorPicker(
            'cinema-background-color-picker-container',
            'cinemaBackgroundColor',
            'Background Color',
            bg.solidColor || '#000000'
        );
        createSimpleColorPicker(
            'cinema-frame-color-picker-container',
            'cinemaFrameColor',
            'Frame Color',
            poster.frameColor || '#333333'
        );
        createSimpleColorPicker(
            'cinema-global-text-color-picker-container',
            'cinemaGlobalTextColor',
            'Text Color',
            (globalEffects && globalEffects.textColor) || '#ffffff'
        );
    }

    function wireModernSliders() {
        // Wire up modern sliders with fill bar animation (like Wallart)
        const sliders = [
            { id: 'cin-h-size', suffix: '%', min: 50, max: 200 },
            { id: 'cin-f-size', suffix: '%', min: 50, max: 200 },
            { id: 'cin-h-tst-intensity', suffix: '%', min: 10, max: 100 },
            { id: 'cin-f-tst-intensity', suffix: '%', min: 10, max: 100 },
            { id: 'cinemaGlobalTstIntensity', suffix: '%', min: 10, max: 100 },
            { id: 'cinemaMetadataOpacity', suffix: '%', min: 0, max: 100 },
            { id: 'cinemaBackgroundBlur', suffix: 'px', min: 5, max: 50 },
            { id: 'cinemaPosterTransition', suffix: 's', min: 0.5, max: 5 },
            { id: 'cinemaFrameWidth', suffix: 'px', min: 2, max: 20 },
            { id: 'cinemaQRSize', suffix: '%', min: 60, max: 200 },
            { id: 'cinemaContrast', suffix: '%', min: 50, max: 150 },
            { id: 'cinemaBrightness', suffix: '%', min: 50, max: 150 },
        ];

        sliders.forEach(({ id, suffix, min, max }) => {
            const slider = document.getElementById(id);
            if (!slider) return;

            const container = slider.closest('.modern-slider');
            const fill = container?.querySelector('.slider-bar .fill');
            // Look for percentage element: first in parent, then as sibling of parent container
            let percentageEl = container?.parentElement?.querySelector('.slider-percentage');
            if (!percentageEl) {
                // Try sibling of .slider-with-reset wrapper
                const wrapper = slider.closest('.slider-with-reset');
                percentageEl = wrapper?.parentElement?.querySelector('.slider-percentage');
            }
            // Also support .modern-slider-wrap with .modern-slider-value
            const wrapContainer = slider.closest('.modern-slider-wrap');
            const valueEl = wrapContainer?.querySelector('.modern-slider-value');

            const updateSlider = () => {
                const value = parseFloat(slider.value);
                const percent = ((value - min) / (max - min)) * 100;
                if (fill) fill.style.width = `${percent}%`;
                if (percentageEl) percentageEl.textContent = value + suffix;
                if (valueEl) valueEl.textContent = value + suffix;
            };

            slider.addEventListener('input', updateSlider);
            updateSlider(); // Initial state
        });

        // Wire reset buttons for sliders
        document.querySelectorAll('.reset-btn[data-reset-target]').forEach(btn => {
            btn.addEventListener('click', () => {
                const targetId = btn.dataset.resetTarget;
                const resetValue = btn.dataset.resetValue || '100';
                const slider = document.getElementById(targetId);
                if (slider) {
                    slider.value = resetValue;
                    slider.dispatchEvent(new Event('input'));
                }
            });
        });
    }

    function wireConditionalVisibility() {
        // Cinematic Transitions: show single transition dropdown only when mode is 'single'
        const transitionModeSelect = $('#cinemaTransitionMode');
        const singleTransitionRow = document.getElementById('singleTransitionRow');
        const enabledTransitionsRow = document.getElementById('enabledTransitionsRow');
        if (transitionModeSelect) {
            const syncTransitionModeVisibility = () => {
                const mode = transitionModeSelect.value;
                if (singleTransitionRow) {
                    singleTransitionRow.style.display = mode === 'single' ? '' : 'none';
                }
                // Hide checkboxes when in single mode (only one transition matters)
                if (enabledTransitionsRow) {
                    enabledTransitionsRow.style.display = mode === 'single' ? 'none' : '';
                }
            };
            transitionModeSelect.addEventListener('change', syncTransitionModeVisibility);
            syncTransitionModeVisibility();
        }

        // Font Family: show custom font input when 'custom' is selected
        const fontFamilySelect = $('#cinemaFontFamily');
        const customFontRow = $('#cinemaCustomFontRow');
        if (fontFamilySelect && customFontRow) {
            const syncFontVisibility = () => {
                const isCustom = fontFamilySelect.value === 'custom';
                customFontRow.style.display = isCustom ? '' : 'none';
            };
            fontFamilySelect.addEventListener('change', syncFontVisibility);
            syncFontVisibility();
        }

        // Global Effects: show tint color picker only when colorFilter is 'tint'
        const colorFilterSelect = $('#cinemaColorFilter');
        const tintColorContainer = document.getElementById('cinema-tint-color-picker-container');
        if (colorFilterSelect && tintColorContainer) {
            const syncTintVisibility = () => {
                tintColorContainer.style.display = colorFilterSelect.value === 'tint' ? '' : 'none';
            };
            colorFilterSelect.addEventListener('change', syncTintVisibility);
            syncTintVisibility();
        }

        // Background: show blur settings only when mode is 'blurred', color only when 'solid'
        const bgModeSelect = $('#cinemaBackgroundMode');
        const blurRow = $('#cinemaBackgroundBlurRow');
        const colorContainer = document.getElementById('cinema-background-color-picker-container');
        if (bgModeSelect) {
            const syncBgVisibility = () => {
                const mode = bgModeSelect.value;
                if (blurRow) blurRow.style.display = mode === 'blurred' ? '' : 'none';
                if (colorContainer) colorContainer.style.display = mode === 'solid' ? '' : 'none';
            };
            bgModeSelect.addEventListener('change', syncBgVisibility);
            syncBgVisibility();
        }

        // Poster: show frame controls for styles that use borders
        const posterStyleSelect = $('#cinemaPosterStyle');
        const frameColorContainer = document.getElementById('cinema-frame-color-picker-container');
        const frameColorModeRow = $('#cinemaFrameColorModeRow');
        const frameColorModeSelect = $('#cinemaFrameColorMode');
        const frameWidthRow = $('#cinemaFrameWidthRow');

        // Frame Color Mode: show/hide color picker based on mode (define first)
        const syncFrameColorPickerVisibility = () => {
            const style = posterStyleSelect?.value || 'floating';
            const mode = frameColorModeSelect?.value || 'custom';
            const stylesWithFrame = ['framed', 'shadowBox', 'neon', 'doubleBorder', 'ornate'];
            const hasFrame = stylesWithFrame.includes(style);
            const isCustom = mode === 'custom';
            // Only show color picker if frame style AND custom mode
            if (frameColorContainer) {
                frameColorContainer.style.display = hasFrame && isCustom ? '' : 'none';
            }
        };

        if (posterStyleSelect) {
            const syncPosterVisibility = () => {
                const style = posterStyleSelect.value;
                // Show frame controls for framed, shadowBox, neon, doubleBorder, ornate
                const stylesWithFrame = ['framed', 'shadowBox', 'neon', 'doubleBorder', 'ornate'];
                const show = stylesWithFrame.includes(style);
                if (frameColorModeRow) frameColorModeRow.style.display = show ? '' : 'none';
                if (frameWidthRow) frameWidthRow.style.display = show ? '' : 'none';
                // Color picker visibility depends on both style and mode
                syncFrameColorPickerVisibility();
            };
            posterStyleSelect.addEventListener('change', syncPosterVisibility);
            syncPosterVisibility();
        }

        if (frameColorModeSelect) {
            frameColorModeSelect.addEventListener('change', syncFrameColorPickerVisibility);
            syncFrameColorPickerVisibility();
        }

        // Wire global typography master controls (presets are wired in init())
        wireGlobalTypographyControls();
    }

    // === Cinema Presets (12 complete looks) ===
    const CINEMA_PRESETS = {
        classicCinema: {
            label: 'Classic Cinema',
            poster: {
                style: 'shadowBox',
                overlay: 'none',
                frameColor: '#222222',
                frameColorMode: 'custom',
            },
            background: { mode: 'gradient', vignette: 'subtle' },
            globalEffects: { colorFilter: 'none', contrast: 100, brightness: 100 },
            typography: {
                fontFamily: 'cinematic',
                textColorMode: 'custom',
                textColor: '#ffffff',
                textEffect: 'subtle',
            },
        },
        noir: {
            label: 'Noir',
            poster: {
                style: 'framed',
                overlay: 'grain',
                frameColor: '#444444',
                frameColorMode: 'custom',
            },
            background: { mode: 'solid', solidColor: '#0a0a0a', vignette: 'dramatic' },
            globalEffects: { colorFilter: 'sepia', contrast: 120, brightness: 90 },
            typography: {
                fontFamily: 'classic',
                textColorMode: 'custom',
                textColor: '#d4d4d4',
                textEffect: 'dramatic',
            },
        },
        neonNights: {
            label: 'Neon Nights',
            poster: {
                style: 'neon',
                overlay: 'none',
                frameColor: '#ff00ff',
                frameColorMode: 'custom',
            },
            background: { mode: 'starfield', vignette: 'none' },
            globalEffects: { colorFilter: 'cool', contrast: 110, brightness: 100 },
            typography: {
                fontFamily: 'neon',
                textColorMode: 'custom',
                textColor: '#00ffff',
                textEffect: 'neon',
            },
        },
        vintageTheater: {
            label: 'Vintage Theater',
            poster: {
                style: 'ornate',
                overlay: 'none',
                frameColor: '#8b4513',
                frameColorMode: 'custom',
            },
            background: { mode: 'curtain', vignette: 'subtle' },
            globalEffects: { colorFilter: 'warm', contrast: 105, brightness: 95 },
            typography: {
                fontFamily: 'classic',
                textColorMode: 'custom',
                textColor: '#f5deb3',
                textEffect: 'subtle',
            },
        },
        modernMinimal: {
            label: 'Modern Minimal',
            poster: { style: 'fullBleed', overlay: 'none', frameColorMode: 'custom' },
            background: { mode: 'solid', solidColor: '#000000', vignette: 'none' },
            globalEffects: { colorFilter: 'none', contrast: 100, brightness: 100 },
            typography: {
                fontFamily: 'system',
                textColorMode: 'custom',
                textColor: '#ffffff',
                textEffect: 'none',
            },
        },
        filmProjector: {
            label: 'Film Projector',
            poster: { style: 'floating', overlay: 'oldMovie', frameColorMode: 'custom' },
            background: { mode: 'blurred', vignette: 'dramatic' },
            globalEffects: { colorFilter: 'sepia', contrast: 110, brightness: 95 },
            typography: {
                fontFamily: 'marquee',
                textColorMode: 'custom',
                textColor: '#ffe4b5',
                textEffect: 'subtle',
            },
        },
        blockbuster: {
            label: 'Blockbuster',
            poster: {
                style: 'shadowBox',
                overlay: 'none',
                frameColor: '#1a1a2e',
                frameColorMode: 'custom',
            },
            background: { mode: 'spotlight', vignette: 'dramatic' },
            globalEffects: { colorFilter: 'none', contrast: 115, brightness: 105 },
            typography: {
                fontFamily: 'bold',
                textColorMode: 'custom',
                textColor: '#ffd700',
                textEffect: 'dramatic',
            },
        },
        artDeco: {
            label: 'Art Deco',
            poster: {
                style: 'doubleBorder',
                overlay: 'none',
                frameColor: '#c9a227',
                frameColorMode: 'custom',
            },
            background: { mode: 'solid', solidColor: '#1a1a1a', vignette: 'subtle' },
            globalEffects: { colorFilter: 'warm', contrast: 105, brightness: 100 },
            typography: {
                fontFamily: 'elegant',
                textColorMode: 'custom',
                textColor: '#c9a227',
                textEffect: 'glow',
            },
        },
        driveIn: {
            label: 'Drive-In',
            poster: {
                style: 'polaroid',
                overlay: 'grain',
                frameColor: '#ffffff',
                frameColorMode: 'custom',
            },
            background: { mode: 'starfield', vignette: 'subtle' },
            globalEffects: { colorFilter: 'none', contrast: 100, brightness: 95 },
            typography: {
                fontFamily: 'retro',
                textColorMode: 'custom',
                textColor: '#ff6b6b',
                textEffect: 'neon',
            },
        },
        imaxPremium: {
            label: 'IMAX Premium',
            poster: { style: 'floating', overlay: 'none', frameColorMode: 'custom' },
            background: { mode: 'ambient', vignette: 'none' },
            globalEffects: { colorFilter: 'none', contrast: 110, brightness: 100 },
            typography: {
                fontFamily: 'epic',
                textColorMode: 'custom',
                textColor: '#ffffff',
                textEffect: 'subtle',
            },
        },
        indieFilm: {
            label: 'Indie Film',
            poster: {
                style: 'framed',
                overlay: 'paper',
                frameColor: '#2d2d2d',
                frameColorMode: 'custom',
            },
            background: { mode: 'blurred', vignette: 'subtle' },
            globalEffects: { colorFilter: 'none', contrast: 95, brightness: 95 },
            typography: {
                fontFamily: 'modern',
                textColorMode: 'tonSurTon',
                tonSurTonIntensity: 50,
                textEffect: 'none',
            },
        },
        homeTheater: {
            label: 'Home Theater',
            poster: { style: 'floating', overlay: 'none', frameColorMode: 'tonSurTonDark' },
            background: { mode: 'ambient', vignette: 'subtle' },
            globalEffects: { colorFilter: 'none', contrast: 100, brightness: 100 },
            typography: {
                fontFamily: 'cinematic',
                textColorMode: 'tonSurTon',
                tonSurTonIntensity: 45,
                textEffect: 'subtle',
            },
        },
        reset: {
            label: 'Reset to Defaults',
            poster: {
                style: 'floating',
                overlay: 'none',
                frameColor: '#ffffff',
                frameColorMode: 'custom',
            },
            background: { mode: 'solid', solidColor: '#000000', vignette: 'subtle' },
            globalEffects: { colorFilter: 'none', contrast: 100, brightness: 100 },
            typography: {
                fontFamily: 'cinematic',
                textColorMode: 'custom',
                textColor: '#C0C0C0',
                tonSurTonIntensity: 45,
                textEffect: 'subtle',
            },
        },
    };

    // === Apply Cinema Preset ===
    // Helper to set field value and trigger change tracking
    function setFieldValue(el, value, eventType = 'change') {
        if (!el) return;
        if (el.type === 'checkbox') {
            el.checked = value;
        } else {
            el.value = value;
        }
        // Dispatch event with bubbles:true so unsavedTracker can catch it
        el.dispatchEvent(new Event(eventType, { bubbles: true }));
    }

    // Mark cinema settings as dirty (forces unsaved changes indicator)
    function markCinemaSettingsDirty() {
        // Use the unsavedTracker directly if available
        if (window.unsavedTracker) {
            window.unsavedTracker.init('section-display');
            window.unsavedTracker.changes.get('section-display')?.add('__cinemaPresetApplied');
            window.unsavedTracker.updateIndicator('section-display');
        }
    }

    function applyPreset(presetKey) {
        if (!presetKey || !CINEMA_PRESETS[presetKey]) return;

        const preset = CINEMA_PRESETS[presetKey];

        // Apply poster settings
        if (preset.poster) {
            if (preset.poster.style) {
                setFieldValue($('#cinemaPosterStyle'), preset.poster.style);
            }
            if (preset.poster.overlay) {
                setFieldValue($('#cinemaPosterOverlay'), preset.poster.overlay);
            }
            if (preset.poster.frameColor) {
                setFieldValue($('#cinemaFrameColor'), preset.poster.frameColor);
            }
            if (preset.poster.frameColorMode) {
                setFieldValue($('#cinemaFrameColorMode'), preset.poster.frameColorMode);
            }
        }

        // Apply background settings
        if (preset.background) {
            if (preset.background.mode) {
                setFieldValue($('#cinemaBackgroundMode'), preset.background.mode);
            }
            if (preset.background.vignette) {
                setFieldValue($('#cinemaVignette'), preset.background.vignette);
            }
            if (preset.background.solidColor) {
                setFieldValue($('#cinemaBackgroundColor'), preset.background.solidColor);
            }
        }

        // Apply global effects
        if (preset.globalEffects) {
            if (preset.globalEffects.colorFilter) {
                setFieldValue($('#cinemaColorFilter'), preset.globalEffects.colorFilter);
            }
            if (preset.globalEffects.contrast !== undefined) {
                setFieldValue($('#cinemaContrast'), preset.globalEffects.contrast, 'input');
            }
            if (preset.globalEffects.brightness !== undefined) {
                setFieldValue($('#cinemaBrightness'), preset.globalEffects.brightness, 'input');
            }
        }

        // Apply typography (synced to header + footer)
        if (preset.typography) {
            applyGlobalTypography(preset.typography);
        }

        // Force unsaved changes indicator
        markCinemaSettingsDirty();
    }

    // === Apply Global Typography to Header + Footer ===
    function applyGlobalTypography(typo) {
        // Font Family
        if (typo.fontFamily) {
            setFieldValue($('#cinemaGlobalFont'), typo.fontFamily);
            setFieldValue($('#cin-h-font'), typo.fontFamily);
            setFieldValue($('#cin-f-font'), typo.fontFamily);
        }

        // Text Color Mode (custom vs ton-sur-ton)
        if (typo.textColorMode) {
            const isTonSurTon = typo.textColorMode === 'tonSurTon';
            setFieldValue($('#cinemaGlobalTextColorMode'), typo.textColorMode);
            setFieldValue($('#cin-h-tst'), isTonSurTon);
            setFieldValue($('#cin-f-tst'), isTonSurTon);
        }

        // Text Color (when custom)
        if (typo.textColor && typo.textColorMode === 'custom') {
            setFieldValue($('#cinemaGlobalTextColor'), typo.textColor);
            setFieldValue($('#cin-h-color'), typo.textColor);
            setFieldValue($('#cin-f-color'), typo.textColor);
        }

        // Ton-sur-ton Intensity
        if (typo.tonSurTonIntensity !== undefined) {
            setFieldValue($('#cinemaGlobalTstIntensity'), typo.tonSurTonIntensity, 'input');
            setFieldValue($('#cin-h-tst-intensity'), typo.tonSurTonIntensity, 'input');
            setFieldValue($('#cin-f-tst-intensity'), typo.tonSurTonIntensity, 'input');
        }

        // Text Effect (shadow) - Issue #126: textEffect is now separate from shadow
        if (typo.textEffect) {
            setFieldValue($('#cinemaGlobalTextEffect'), typo.textEffect);
            // Map to advanced text effect dropdown if it exists
            setFieldValue($('#cin-h-texteffect'), typo.textEffect);
        }

        // Shadow (basic shadow effects)
        if (typo.shadow) {
            setFieldValue($('#cin-h-shadow'), typo.shadow);
            // Footer has fewer options, map to closest match
            const footerValue = ['none', 'subtle', 'dramatic'].includes(typo.shadow)
                ? typo.shadow
                : 'subtle';
            setFieldValue($('#cin-f-shadow'), footerValue);
        }
    }

    // === Wire Global Typography Controls ===
    function wireGlobalTypographyControls() {
        // Global Font Family → sync to header + footer
        const globalFontSelect = $('#cinemaGlobalFont');
        if (globalFontSelect) {
            globalFontSelect.addEventListener('change', () => {
                const value = globalFontSelect.value;
                const headerFontSelect = $('#cin-h-font');
                const footerFontSelect = $('#cin-f-font');
                if (headerFontSelect) headerFontSelect.value = value;
                if (footerFontSelect) footerFontSelect.value = value;
            });
        }

        // Global Text Color Mode → sync to header + footer ton-sur-ton
        const globalColorModeSelect = $('#cinemaGlobalTextColorMode');
        if (globalColorModeSelect) {
            globalColorModeSelect.addEventListener('change', () => {
                const isTonSurTon = globalColorModeSelect.value === 'tonSurTon';
                const headerTst = $('#cin-h-tst');
                const footerTst = $('#cin-f-tst');
                if (headerTst) {
                    headerTst.checked = isTonSurTon;
                    headerTst.dispatchEvent(new Event('change'));
                }
                if (footerTst) {
                    footerTst.checked = isTonSurTon;
                    footerTst.dispatchEvent(new Event('change'));
                }
                // Show/hide color picker vs intensity slider
                updateGlobalColorModeVisibility(isTonSurTon);
            });
        }

        // Global Text Color → sync to header + footer color
        const globalColorInput = $('#cinemaGlobalTextColor');
        if (globalColorInput) {
            globalColorInput.addEventListener('input', () => {
                const value = globalColorInput.value;
                const headerColorInput = $('#cin-h-color');
                const footerColorInput = $('#cin-f-color');
                if (headerColorInput) headerColorInput.value = value;
                if (footerColorInput) footerColorInput.value = value;
            });
        }

        // Global Ton-sur-ton Intensity → sync to header + footer intensity
        const globalIntensitySlider = $('#cinemaGlobalTstIntensity');
        if (globalIntensitySlider) {
            globalIntensitySlider.addEventListener('input', () => {
                const value = globalIntensitySlider.value;
                const headerIntensitySlider = $('#cin-h-tst-intensity');
                const footerIntensitySlider = $('#cin-f-tst-intensity');
                if (headerIntensitySlider) {
                    headerIntensitySlider.value = value;
                    headerIntensitySlider.dispatchEvent(new Event('input'));
                }
                if (footerIntensitySlider) {
                    footerIntensitySlider.value = value;
                    footerIntensitySlider.dispatchEvent(new Event('input'));
                }
                // Update percentage display
                const pctEl = document.querySelector(
                    '[data-target="cinema.globalEffects.tonSurTonIntensity"]'
                );
                if (pctEl) pctEl.textContent = `${value}%`;
            });
        }

        // Global Text Effect → sync to header textEffect (Issue #126: now syncs to advanced text effect)
        const globalEffectSelect = $('#cinemaGlobalTextEffect');
        if (globalEffectSelect) {
            globalEffectSelect.addEventListener('change', () => {
                const value = globalEffectSelect.value;
                // Sync to advanced text effect dropdown
                const headerTextEffectSelect = $('#cin-h-texteffect');
                if (headerTextEffectSelect) headerTextEffectSelect.value = value;
                // Also sync shadow to none when using advanced effect (to avoid conflicts)
                if (value !== 'none' && value !== 'subtle' && value !== 'dramatic') {
                    const headerShadowSelect = $('#cin-h-shadow');
                    if (headerShadowSelect) headerShadowSelect.value = 'none';
                }
            });
        }
    }

    function updateGlobalColorModeVisibility(isTonSurTon) {
        const colorContainer = document.getElementById('cinema-global-text-color-picker-container');
        const intensityRow = document.getElementById('cinemaGlobalTstIntensityRow');
        if (colorContainer) colorContainer.style.display = isTonSurTon ? 'none' : '';
        if (intensityRow) intensityRow.style.display = isTonSurTon ? '' : 'none';
    }

    // === Custom Presets Storage ===
    let customPresets = [];

    function loadCustomPresets() {
        // Load from config via working state or fetch from server
        const ws = getWorkingState();
        if (ws.customPresets) {
            customPresets = ws.customPresets;
        }
        return customPresets;
    }

    function saveCustomPresetsToWorkingState() {
        const ws = getWorkingState();
        ws.customPresets = customPresets;
        saveWorkingState();
    }

    function populateCustomPresetsDropdown() {
        const select = document.getElementById('cinemaPresetSelect');
        if (!select) return;

        // Clear existing options except the placeholder
        while (select.options.length > 1) {
            select.remove(1);
        }

        // Add custom presets
        customPresets.forEach(preset => {
            const option = document.createElement('option');
            option.value = `custom:${preset.id}`;
            option.textContent = preset.name;
            select.appendChild(option);
        });

        // Update placeholder text (shorter for compact layout)
        if (select.options[0]) {
            select.options[0].textContent =
                customPresets.length > 0 ? 'Select preset...' : 'No saved presets';
        }
    }

    function collectCurrentSettingsAsPreset() {
        // Collect enabled transitions from checkboxes
        const enabledTransitions = [];
        document
            .querySelectorAll('#enabledTransitionsGrid input[type="checkbox"]:checked')
            .forEach(cb => {
                enabledTransitions.push(cb.value);
            });

        return {
            // Poster settings
            poster: {
                style: $('#cinemaPosterStyle')?.value || 'floating',
                overlay: $('#cinemaPosterOverlay')?.value || 'none',
                frameColor: $('#cinemaFrameColor')?.value || '#333333',
                frameColorMode: $('#cinemaFrameColorMode')?.value || 'custom',
                frameWidth: parseInt($('#cinemaFrameWidth')?.value || '8', 10),
                transitionDuration: parseFloat($('#cinemaPosterTransition')?.value || '1.5'),
                cinematicTransitions: {
                    enabledTransitions:
                        enabledTransitions.length > 0 ? enabledTransitions : ['fade'],
                    selectionMode: $('#cinemaTransitionMode')?.value || 'random',
                    singleTransition: $('#cinemaSingleTransition')?.value || 'fade',
                },
            },
            // Background settings
            background: {
                mode: $('#cinemaBackgroundMode')?.value || 'solid',
                solidColor: $('#cinemaBackgroundColor')?.value || '#000000',
                blurAmount: parseInt($('#cinemaBackgroundBlur')?.value || '20', 10),
                vignette: $('#cinemaVignette')?.value || 'subtle',
            },
            // Global effects & typography
            globalEffects: {
                colorFilter: $('#cinemaColorFilter')?.value || 'none',
                tintColor: $('#cinemaTintColor')?.value || '#ff6b00',
                contrast: parseInt($('#cinemaContrast')?.value || '100', 10),
                brightness: parseInt($('#cinemaBrightness')?.value || '100', 10),
                hideAllUI: !!$('#cinemaHideAllUI')?.checked,
            },
            typography: {
                fontFamily: $('#cinemaGlobalFont')?.value || 'cinematic',
                textColorMode: $('#cinemaGlobalTextColorMode')?.value || 'custom',
                textColor: $('#cinemaGlobalTextColor')?.value || '#ffffff',
                tonSurTonIntensity: parseInt($('#cinemaGlobalTstIntensity')?.value || '45', 10),
                textEffect: $('#cinemaGlobalTextEffect')?.value || 'subtle',
            },
            // Metadata settings
            metadata: {
                opacity: parseInt($('#cinemaMetadataOpacity')?.value || '80', 10),
                layout: $('#cinemaMetadataLayout')?.value || 'comfortable',
                showYear: $('#cinemaShowYear')?.checked !== false,
                showRuntime: $('#cinemaShowRuntime')?.checked !== false,
                showRating: $('#cinemaShowRating')?.checked !== false,
                showCertification: !!$('#cinemaShowCertification')?.checked,
                showGenre: !!$('#cinemaShowGenre')?.checked,
                showDirector: !!$('#cinemaShowDirector')?.checked,
                showStudioLogo: !!$('#cinemaShowStudioLogo')?.checked,
                specs: {
                    showResolution: $('#cinemaShowResolution')?.checked !== false,
                    showAudio: $('#cinemaShowAudio')?.checked !== false,
                    showHDR: $('#cinemaShowHDR')?.checked !== false,
                    showAspectRatio: !!$('#cinemaShowAspectRatio')?.checked,
                    style: $('#cinemaSpecsStyle')?.value || 'icons-text',
                    iconSet: $('#cinemaSpecsIconSet')?.value || 'tabler',
                },
            },
            // Promotional settings
            promotional: {
                showRating: !!$('#cinemaRatingBadge')?.checked,
                showWatchProviders: !!$('#cinemaWatchProviders')?.checked,
                showAwardsBadge: !!$('#cinemaAwardsBadge')?.checked,
                trailer: {
                    enabled: !!$('#cinemaTrailerEnabled')?.checked,
                    delay: parseInt($('#cinemaTrailerDelay')?.value || '5', 10),
                    muted: $('#cinemaTrailerMuted')?.checked !== false,
                    loop: $('#cinemaTrailerLoop')?.checked !== false,
                    quality: $('#cinemaTrailerQuality')?.value || 'default',
                    autohide: $('#cinemaTrailerAutohide')?.value || 'never',
                    reshow: $('#cinemaTrailerReshow')?.value || 'never',
                },
                qrCode: {
                    enabled: !!$('#cinemaQREnabled')?.checked,
                    urlType: $('#cinemaQRUrlType')?.value || 'trailer',
                    url: $('#cinemaQRUrl')?.value || '',
                    position: $('#cinemaQRPosition')?.value || 'bottomRight',
                    size: parseInt($('#cinemaQRSize')?.value || '100', 10),
                },
            },
            // Header settings
            header: {
                enabled: $('#cin-h-enabled')?.checked || false,
                text: $('#cin-h-presets')?.value || 'Now Playing',
                typography: {
                    fontFamily: $('#cin-h-font')?.value || 'cinematic',
                    fontSize: parseInt($('#cin-h-size')?.value || '100', 10),
                    color: $('#cin-h-color')?.value || '#ffffff',
                    shadow: $('#cin-h-shadow')?.value || 'subtle',
                    textEffect: $('#cin-h-texteffect')?.value || 'none',
                    entranceAnimation: $('#cin-h-entrance')?.value || 'none',
                    decoration: $('#cin-h-decoration')?.value || 'none',
                    tonSurTon: $('#cin-h-tst')?.checked || false,
                    tonSurTonIntensity: parseInt($('#cin-h-tst-intensity')?.value || '45', 10),
                },
            },
            // Footer settings
            footer: {
                enabled: $('#cin-f-enabled')?.checked || false,
                type: $('#cin-f-type')?.value || 'metadata',
                marqueeText: $('#cin-f-presets')?.value || 'Feature Presentation',
                taglineMarquee: $('#cin-f-tagline-marquee')?.checked || false,
                typography: {
                    fontFamily: $('#cin-f-font')?.value || 'system',
                    fontSize: parseInt($('#cin-f-size')?.value || '100', 10),
                    color: $('#cin-f-color')?.value || '#cccccc',
                    shadow: $('#cin-f-shadow')?.value || 'none',
                    tonSurTon: $('#cin-f-tst')?.checked || false,
                    tonSurTonIntensity: parseInt($('#cin-f-tst-intensity')?.value || '45', 10),
                },
            },
            // Ambilight
            ambilight: {
                enabled: $('#cin-a-enabled')?.checked || false,
                strength: parseInt($('#cin-a-strength')?.value || '60', 10),
            },
            // Orientation
            orientation: $('#cinemaOrientation')?.value || 'auto',
        };
    }

    function applyCustomPreset(preset) {
        // Apply poster settings
        if (preset.poster) {
            setFieldValue($('#cinemaPosterStyle'), preset.poster.style || 'floating');
            setFieldValue($('#cinemaPosterOverlay'), preset.poster.overlay || 'none');
            if (preset.poster.frameColor) {
                setFieldValue($('#cinemaFrameColor'), preset.poster.frameColor);
            }
            if (preset.poster.frameColorMode) {
                setFieldValue($('#cinemaFrameColorMode'), preset.poster.frameColorMode);
            }
            if (preset.poster.frameWidth !== undefined) {
                setFieldValue($('#cinemaFrameWidth'), preset.poster.frameWidth, 'input');
            }
            if (preset.poster.transitionDuration !== undefined) {
                setFieldValue(
                    $('#cinemaPosterTransition'),
                    preset.poster.transitionDuration,
                    'input'
                );
            }
            // Cinematic transitions
            if (preset.poster.cinematicTransitions) {
                const ct = preset.poster.cinematicTransitions;
                if (ct.selectionMode) {
                    setFieldValue($('#cinemaTransitionMode'), ct.selectionMode);
                }
                if (ct.singleTransition) {
                    setFieldValue($('#cinemaSingleTransition'), ct.singleTransition);
                }
                // Apply enabled transitions checkboxes
                if (ct.enabledTransitions && Array.isArray(ct.enabledTransitions)) {
                    document
                        .querySelectorAll('#enabledTransitionsGrid input[type="checkbox"]')
                        .forEach(cb => {
                            cb.checked = ct.enabledTransitions.includes(cb.value);
                        });
                }
            }
        }

        // Apply background settings
        if (preset.background) {
            setFieldValue($('#cinemaBackgroundMode'), preset.background.mode || 'solid');
            setFieldValue($('#cinemaVignette'), preset.background.vignette || 'subtle');
            if (preset.background.solidColor) {
                setFieldValue($('#cinemaBackgroundColor'), preset.background.solidColor);
            }
            if (preset.background.blurAmount !== undefined) {
                setFieldValue($('#cinemaBackgroundBlur'), preset.background.blurAmount, 'input');
            }
        }

        // Apply global effects
        if (preset.globalEffects) {
            setFieldValue($('#cinemaColorFilter'), preset.globalEffects.colorFilter || 'none');
            if (preset.globalEffects.contrast !== undefined) {
                setFieldValue($('#cinemaContrast'), preset.globalEffects.contrast, 'input');
            }
            if (preset.globalEffects.brightness !== undefined) {
                setFieldValue($('#cinemaBrightness'), preset.globalEffects.brightness, 'input');
            }
            if (preset.globalEffects.tintColor) {
                setFieldValue($('#cinemaTintColor'), preset.globalEffects.tintColor);
            }
            if ($('#cinemaHideAllUI')) {
                $('#cinemaHideAllUI').checked = !!preset.globalEffects.hideAllUI;
            }
        }

        // Apply typography
        if (preset.typography) {
            applyGlobalTypography(preset.typography);
        }

        // Apply metadata settings
        if (preset.metadata) {
            const meta = preset.metadata;
            if (meta.opacity !== undefined) {
                setFieldValue($('#cinemaMetadataOpacity'), meta.opacity, 'input');
            }
            if (meta.layout) {
                setFieldValue($('#cinemaMetadataLayout'), meta.layout);
            }
            // Checkboxes
            if ($('#cinemaShowYear')) $('#cinemaShowYear').checked = meta.showYear !== false;
            if ($('#cinemaShowRuntime'))
                $('#cinemaShowRuntime').checked = meta.showRuntime !== false;
            if ($('#cinemaShowRating')) $('#cinemaShowRating').checked = meta.showRating !== false;
            if ($('#cinemaShowCertification'))
                $('#cinemaShowCertification').checked = !!meta.showCertification;
            if ($('#cinemaShowGenre')) $('#cinemaShowGenre').checked = !!meta.showGenre;
            if ($('#cinemaShowDirector')) $('#cinemaShowDirector').checked = !!meta.showDirector;
            if ($('#cinemaShowStudioLogo'))
                $('#cinemaShowStudioLogo').checked = !!meta.showStudioLogo;
            // Specs
            if (meta.specs) {
                if ($('#cinemaShowResolution'))
                    $('#cinemaShowResolution').checked = meta.specs.showResolution !== false;
                if ($('#cinemaShowAudio'))
                    $('#cinemaShowAudio').checked = meta.specs.showAudio !== false;
                if ($('#cinemaShowHDR')) $('#cinemaShowHDR').checked = meta.specs.showHDR !== false;
                if ($('#cinemaShowAspectRatio'))
                    $('#cinemaShowAspectRatio').checked = !!meta.specs.showAspectRatio;
                if (meta.specs.style) setFieldValue($('#cinemaSpecsStyle'), meta.specs.style);
                if (meta.specs.iconSet) setFieldValue($('#cinemaSpecsIconSet'), meta.specs.iconSet);
            }
        }

        // Apply promotional settings
        if (preset.promotional) {
            const promo = preset.promotional;
            if ($('#cinemaRatingBadge')) $('#cinemaRatingBadge').checked = !!promo.showRating;
            if ($('#cinemaWatchProviders'))
                $('#cinemaWatchProviders').checked = !!promo.showWatchProviders;
            if ($('#cinemaAwardsBadge')) $('#cinemaAwardsBadge').checked = !!promo.showAwardsBadge;
            // Trailer settings
            if (promo.trailer) {
                const t = promo.trailer;
                if ($('#cinemaTrailerEnabled')) $('#cinemaTrailerEnabled').checked = !!t.enabled;
                if (t.delay !== undefined)
                    setFieldValue($('#cinemaTrailerDelay'), t.delay, 'input');
                if ($('#cinemaTrailerMuted')) $('#cinemaTrailerMuted').checked = t.muted !== false;
                if ($('#cinemaTrailerLoop')) $('#cinemaTrailerLoop').checked = t.loop !== false;
                if (t.quality) setFieldValue($('#cinemaTrailerQuality'), t.quality);
                if (t.autohide) setFieldValue($('#cinemaTrailerAutohide'), t.autohide);
                if (t.reshow) setFieldValue($('#cinemaTrailerReshow'), t.reshow);
            }
            // QR Code settings
            if (promo.qrCode) {
                const qr = promo.qrCode;
                if ($('#cinemaQREnabled')) $('#cinemaQREnabled').checked = !!qr.enabled;
                if (qr.urlType) setFieldValue($('#cinemaQRUrlType'), qr.urlType);
                if (qr.url !== undefined) setFieldValue($('#cinemaQRUrl'), qr.url);
                if (qr.position) setFieldValue($('#cinemaQRPosition'), qr.position);
                if (qr.size !== undefined) setFieldValue($('#cinemaQRSize'), qr.size, 'input');
            }
        }

        // Apply header settings
        if (preset.header) {
            const h = preset.header;
            if ($('#cin-h-enabled')) $('#cin-h-enabled').checked = !!h.enabled;
            if (h.text) setFieldValue($('#cin-h-presets'), h.text);
            if (h.typography) {
                const ht = h.typography;
                if (ht.fontFamily) setFieldValue($('#cin-h-font'), ht.fontFamily);
                if (ht.fontSize !== undefined)
                    setFieldValue($('#cin-h-size'), ht.fontSize, 'input');
                if (ht.color) setFieldValue($('#cin-h-color'), ht.color);
                if (ht.shadow) setFieldValue($('#cin-h-shadow'), ht.shadow);
                if (ht.textEffect) setFieldValue($('#cin-h-texteffect'), ht.textEffect);
                if (ht.entranceAnimation) setFieldValue($('#cin-h-entrance'), ht.entranceAnimation);
                if (ht.decoration) setFieldValue($('#cin-h-decoration'), ht.decoration);
                if ($('#cin-h-tst')) $('#cin-h-tst').checked = !!ht.tonSurTon;
                if (ht.tonSurTonIntensity !== undefined)
                    setFieldValue($('#cin-h-tst-intensity'), ht.tonSurTonIntensity, 'input');
            }
        }

        // Apply footer settings
        if (preset.footer) {
            const f = preset.footer;
            if ($('#cin-f-enabled')) $('#cin-f-enabled').checked = !!f.enabled;
            if (f.type) setFieldValue($('#cin-f-type'), f.type);
            if (f.marqueeText) setFieldValue($('#cin-f-presets'), f.marqueeText);
            if ($('#cin-f-tagline-marquee'))
                $('#cin-f-tagline-marquee').checked = !!f.taglineMarquee;
            if (f.typography) {
                const ft = f.typography;
                if (ft.fontFamily) setFieldValue($('#cin-f-font'), ft.fontFamily);
                if (ft.fontSize !== undefined)
                    setFieldValue($('#cin-f-size'), ft.fontSize, 'input');
                if (ft.color) setFieldValue($('#cin-f-color'), ft.color);
                if (ft.shadow) setFieldValue($('#cin-f-shadow'), ft.shadow);
                if ($('#cin-f-tst')) $('#cin-f-tst').checked = !!ft.tonSurTon;
                if (ft.tonSurTonIntensity !== undefined)
                    setFieldValue($('#cin-f-tst-intensity'), ft.tonSurTonIntensity, 'input');
            }
        }

        // Apply ambilight settings
        if (preset.ambilight) {
            if ($('#cin-a-enabled')) $('#cin-a-enabled').checked = !!preset.ambilight.enabled;
            if (preset.ambilight.strength !== undefined) {
                setFieldValue($('#cin-a-strength'), preset.ambilight.strength, 'input');
            }
        }

        // Apply orientation
        if (preset.orientation) {
            setFieldValue($('#cinemaOrientation'), preset.orientation);
        }

        // Force unsaved changes indicator
        markCinemaSettingsDirty();
    }

    function _isSystemPreset(presetValue) {
        return presetValue && !presetValue.startsWith('custom:');
    }

    function getCustomPresetById(id) {
        return customPresets.find(p => p.id === id);
    }

    // Wire presets dropdown in Presets card
    function wirePresets() {
        const presetSelect = document.getElementById('cinemaPresetSelect');
        const saveBtn = document.getElementById('cinemaPresetSave');
        const deleteBtn = document.getElementById('cinemaPresetDelete');
        const presetsMount = document.getElementById('cinema-presets-mount');

        console.log('[Cinema] wirePresets called', {
            presetSelect,
            saveBtn,
            deleteBtn,
            presetsMount,
        });

        // Wire quick preset buttons (icon buttons)
        if (presetsMount) {
            presetsMount.addEventListener('click', e => {
                const btn = e.target.closest('button[data-cin-preset]');
                if (!btn) return;
                const presetKey = btn.getAttribute('data-cin-preset');
                applyPreset(presetKey);
            });
        }

        // Load custom presets and populate dropdown
        loadCustomPresets();
        if (presetSelect) {
            populateCustomPresetsDropdown();

            // Apply preset on selection (custom presets only now)
            presetSelect.addEventListener('change', () => {
                const presetKey = presetSelect.value;
                if (!presetKey) {
                    return;
                }

                if (presetKey.startsWith('custom:')) {
                    const customId = presetKey.replace('custom:', '');
                    const customPreset = getCustomPresetById(customId);
                    if (customPreset) {
                        applyCustomPreset(customPreset);
                    }
                }
            });
        }

        // Save current settings as new preset (using modal)
        if (saveBtn) {
            console.log('[Cinema] Wiring save button');
            saveBtn.addEventListener('click', () => {
                console.log('[Cinema] Save button clicked');
                const modal = document.getElementById('modal-cinema-preset-save');
                const input = document.getElementById('cinema-preset-name-input');
                const okBtn = document.getElementById('cinema-preset-save-ok');
                console.log('[Cinema] Modal elements:', { modal, input, okBtn });
                if (!modal || !input || !okBtn) {
                    console.error('[Cinema] Missing modal elements for save');
                    return;
                }

                // Clear input and show modal
                input.value = '';
                modal.removeAttribute('hidden');
                modal.classList.add('open');
                setTimeout(() => input.focus(), 50);

                // Handle save
                const handleSave = async () => {
                    const name = input.value.trim();
                    if (!name) return;

                    const id = `custom_${Date.now()}`;
                    const settings = collectCurrentSettingsAsPreset();

                    const newPreset = {
                        id,
                        name,
                        ...settings,
                    };

                    customPresets.push(newPreset);
                    populateCustomPresetsDropdown();

                    // Select the new preset
                    if (presetSelect) {
                        presetSelect.value = `custom:${id}`;
                    }

                    // Close modal
                    modal.classList.remove('open');
                    cleanup();

                    // Save preset AND current cinema settings to server
                    // This ensures the active cinema config matches the preset we just saved
                    try {
                        if (typeof window.saveConfigPatch === 'function') {
                            await window.saveConfigPatch({
                                cinema: {
                                    // Save the preset to customStyles
                                    presets: {
                                        customStyles: customPresets,
                                    },
                                    // Also save ALL current settings as the active config
                                    // so they persist after page refresh
                                    selectedPreset: `custom:${id}`,
                                    poster: settings.poster,
                                    background: settings.background,
                                    globalEffects: settings.globalEffects,
                                    typography: settings.typography,
                                    metadata: settings.metadata,
                                    promotional: settings.promotional,
                                    header: settings.header,
                                    footer: settings.footer,
                                    ambilight: settings.ambilight,
                                    orientation: settings.orientation,
                                },
                            });
                            // Also update workingState to keep in sync
                            saveCustomPresetsToWorkingState();
                            window.showToast?.(`Preset "${name}" saved!`, 'success');
                        } else {
                            // Fallback: save to working state (will require Save Settings)
                            saveCustomPresetsToWorkingState();
                            window.showToast?.(
                                `Preset "${name}" saved (save settings to persist)`,
                                'warning'
                            );
                        }
                    } catch (err) {
                        console.error('[Cinema] Failed to save preset:', err);
                        window.showToast?.('Failed to save preset', 'error');
                    }
                };

                const handleClose = () => {
                    modal.classList.remove('open');
                    cleanup();
                };

                const cleanup = () => {
                    okBtn.removeEventListener('click', handleSave);
                    modal.querySelectorAll('[data-close-modal]').forEach(btn => {
                        btn.removeEventListener('click', handleClose);
                    });
                    input.removeEventListener('keydown', handleKeydown);
                };

                const handleKeydown = e => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        handleSave();
                    } else if (e.key === 'Escape') {
                        handleClose();
                    }
                };

                okBtn.addEventListener('click', handleSave);
                modal.querySelectorAll('[data-close-modal]').forEach(btn => {
                    btn.addEventListener('click', handleClose);
                });
                input.addEventListener('keydown', handleKeydown);
            });
        }

        // Delete custom preset (using modal with preset list)
        if (deleteBtn) {
            console.log('[Cinema] Wiring delete button');
            deleteBtn.addEventListener('click', () => {
                console.log('[Cinema] Delete button clicked');

                const modal = document.getElementById('modal-cinema-preset-delete');
                const listContainer = document.getElementById('cinema-preset-delete-list');
                const emptyMsg = document.getElementById('cinema-preset-delete-empty');
                const okBtn = document.getElementById('cinema-preset-delete-ok');
                if (!modal || !listContainer || !okBtn) return;

                // Track selected preset for deletion
                let selectedPresetId = null;

                // Populate the list with custom presets
                listContainer.innerHTML = '';
                okBtn.disabled = true;

                if (customPresets.length === 0) {
                    if (emptyMsg) emptyMsg.style.display = 'block';
                } else {
                    if (emptyMsg) emptyMsg.style.display = 'none';
                    customPresets.forEach(preset => {
                        const item = document.createElement('button');
                        item.type = 'button';
                        item.className = 'btn btn-secondary btn-sm cinema-preset-delete-item';
                        item.style.cssText = 'text-align:left; justify-content:flex-start;';
                        item.dataset.presetId = preset.id;
                        item.innerHTML = `<i class="fas fa-palette" aria-hidden="true"></i> <span>${preset.name}</span>`;
                        item.addEventListener('click', () => {
                            // Deselect all, select this one
                            listContainer
                                .querySelectorAll('.cinema-preset-delete-item')
                                .forEach(btn => {
                                    btn.classList.remove('selected');
                                    btn.style.borderColor = '';
                                });
                            item.classList.add('selected');
                            item.style.borderColor = 'var(--color-error, #f7768e)';
                            selectedPresetId = preset.id;
                            okBtn.disabled = false;
                        });
                        listContainer.appendChild(item);
                    });
                }

                // Show modal
                modal.removeAttribute('hidden');
                modal.classList.add('open');

                const handleDelete = async () => {
                    if (!selectedPresetId) return;

                    const preset = customPresets.find(p => p.id === selectedPresetId);
                    const presetName = preset?.name || 'Preset';

                    customPresets = customPresets.filter(p => p.id !== selectedPresetId);
                    populateCustomPresetsDropdown();

                    // If deleted preset was selected in dropdown, reset it
                    if (presetSelect && presetSelect.value === `custom:${selectedPresetId}`) {
                        presetSelect.value = '';
                    }

                    // Close modal
                    modal.classList.remove('open');
                    cleanup();

                    // Save directly to server
                    try {
                        if (typeof window.saveConfigPatch === 'function') {
                            await window.saveConfigPatch({
                                cinema: {
                                    presets: {
                                        customStyles: customPresets,
                                    },
                                },
                            });
                            // Also update workingState to keep in sync
                            saveCustomPresetsToWorkingState();
                            window.showToast?.(`Preset "${presetName}" deleted`, 'info');
                        } else {
                            saveCustomPresetsToWorkingState();
                            window.showToast?.(
                                `Preset "${presetName}" deleted (save settings to persist)`,
                                'warning'
                            );
                        }
                    } catch (err) {
                        console.error('[Cinema] Failed to delete preset:', err);
                        window.showToast?.('Failed to delete preset', 'error');
                    }
                };

                const handleClose = () => {
                    modal.classList.remove('open');
                    cleanup();
                };

                const cleanup = () => {
                    okBtn.removeEventListener('click', handleDelete);
                    modal.querySelectorAll('[data-close-modal]').forEach(btn => {
                        btn.removeEventListener('click', handleClose);
                    });
                    selectedPresetId = null;
                };

                okBtn.addEventListener('click', handleDelete);
                modal.querySelectorAll('[data-close-modal]').forEach(btn => {
                    btn.addEventListener('click', handleClose);
                });
            });
        }
    }

    // === NEW: Collect enhanced settings for save ===
    function collectEnhancedSettings() {
        // Collect enabled transitions from checkboxes
        const enabledTransitions = [];
        document
            .querySelectorAll('#enabledTransitionsGrid input[type="checkbox"]:checked')
            .forEach(cb => {
                enabledTransitions.push(cb.value);
            });

        return {
            poster: {
                style: $('#cinemaPosterStyle')?.value || 'floating',
                overlay: $('#cinemaPosterOverlay')?.value || 'none',
                cinematicTransitions: {
                    enabledTransitions:
                        enabledTransitions.length > 0 ? enabledTransitions : ['fade'],
                    selectionMode: $('#cinemaTransitionMode')?.value || 'random',
                    singleTransition: $('#cinemaSingleTransition')?.value || 'fade',
                },
                transitionDuration: parseFloat($('#cinemaPosterTransition')?.value || '1.5'),
                frameColor: $('#cinemaFrameColor')?.value || '#333333',
                frameColorMode: $('#cinemaFrameColorMode')?.value || 'custom',
                frameWidth: parseInt($('#cinemaFrameWidth')?.value || '8', 10),
            },
            background: {
                mode: $('#cinemaBackgroundMode')?.value || 'solid',
                solidColor: $('#cinemaBackgroundColor')?.value || '#000000',
                blurAmount: parseInt($('#cinemaBackgroundBlur')?.value || '20', 10),
                vignette: $('#cinemaVignette')?.value || 'subtle',
            },
            metadata: {
                opacity: parseInt($('#cinemaMetadataOpacity')?.value || '80', 10),
                layout: $('#cinemaMetadataLayout')?.value || 'comfortable',
                showYear: $('#cinemaShowYear')?.checked !== false,
                showRuntime: $('#cinemaShowRuntime')?.checked !== false,
                showRating: $('#cinemaShowRating')?.checked !== false,
                showCertification: !!$('#cinemaShowCertification')?.checked,
                showGenre: !!$('#cinemaShowGenre')?.checked,
                showDirector: !!$('#cinemaShowDirector')?.checked,
                showStudioLogo: !!$('#cinemaShowStudioLogo')?.checked,
                position: 'bottom',
                specs: {
                    showResolution: $('#cinemaShowResolution')?.checked !== false,
                    showAudio: $('#cinemaShowAudio')?.checked !== false,
                    showHDR: $('#cinemaShowHDR')?.checked !== false,
                    showAspectRatio: !!$('#cinemaShowAspectRatio')?.checked,
                    style: $('#cinemaSpecsStyle')?.value || 'icons-text',
                    iconSet: $('#cinemaSpecsIconSet')?.value || 'tabler',
                },
            },
            promotional: {
                showRating: !!$('#cinemaRatingBadge')?.checked,
                showWatchProviders: !!$('#cinemaWatchProviders')?.checked,
                showAwardsBadge: !!$('#cinemaAwardsBadge')?.checked,
                trailer: {
                    enabled: !!$('#cinemaTrailerEnabled')?.checked,
                    delay: parseInt($('#cinemaTrailerDelay')?.value || '5', 10),
                    muted: $('#cinemaTrailerMuted')?.checked !== false,
                    loop: $('#cinemaTrailerLoop')?.checked !== false,
                    quality: $('#cinemaTrailerQuality')?.value || 'default',
                    autohide: $('#cinemaTrailerAutohide')?.value || 'never',
                    reshow: $('#cinemaTrailerReshow')?.value || 'never',
                },
                qrCode: {
                    enabled: !!$('#cinemaQREnabled')?.checked,
                    urlType: $('#cinemaQRUrlType')?.value || 'trailer',
                    url: $('#cinemaQRUrl')?.value || '',
                    position: $('#cinemaQRPosition')?.value || 'bottomRight',
                    size: parseInt($('#cinemaQRSize')?.value || '100', 10),
                },
            },
            globalEffects: {
                colorFilter: $('#cinemaColorFilter')?.value || 'none',
                tintColor: $('#cinemaTintColor')?.value || '#ff6b00',
                contrast: parseInt($('#cinemaContrast')?.value || '100', 10),
                brightness: parseInt($('#cinemaBrightness')?.value || '100', 10),
                hideAllUI: !!$('#cinemaHideAllUI')?.checked,
                // Global typography master controls
                fontFamily: $('#cinemaGlobalFont')?.value || 'cinematic',
                textColorMode: $('#cinemaGlobalTextColorMode')?.value || 'custom',
                textColor: $('#cinemaGlobalTextColor')?.value || '#ffffff',
                tonSurTonIntensity: parseInt($('#cinemaGlobalTstIntensity')?.value || '45', 10),
                textEffect: $('#cinemaGlobalTextEffect')?.value || 'subtle',
            },
            selectedPreset: $('#cinemaPresetSelect')?.value || '',
        };
    }

    function collectCinemaOnly(baseCfg) {
        const _cfg = baseCfg || {};

        // Collect priority order from sortable container
        const sortableContainer = document.querySelector('.ctx-sortable-container');
        const priorityOrderArr = sortableContainer
            ? Array.from(sortableContainer.querySelectorAll('.ctx-sortable')).map(r =>
                  r.getAttribute('data-ctx-key')
              )
            : [
                  'nowPlaying',
                  'ultra4k',
                  'certifiedFresh',
                  'comingSoon',
                  'newArrival',
                  'lateNight',
                  'weekend',
              ];

        // Collect context headers settings
        const contextHeaders = {
            enabled: $('#cin-ctx-enabled')?.checked || false,
            default: $('#cin-ctx-default')?.value || 'Now Playing',
            nowPlaying:
                $('#cin-ctx-nowPlaying')?.value === '__inherit__'
                    ? null
                    : $('#cin-ctx-nowPlaying')?.value || 'Now Playing',
            comingSoon:
                $('#cin-ctx-comingSoon')?.value === '__inherit__'
                    ? null
                    : $('#cin-ctx-comingSoon')?.value || 'Coming Soon',
            certifiedFresh:
                $('#cin-ctx-certifiedFresh')?.value === '__inherit__'
                    ? null
                    : $('#cin-ctx-certifiedFresh')?.value || 'Certified Fresh',
            lateNight:
                $('#cin-ctx-lateNight')?.value === '__inherit__'
                    ? null
                    : $('#cin-ctx-lateNight')?.value || 'Late Night Feature',
            weekend:
                $('#cin-ctx-weekend')?.value === '__inherit__'
                    ? null
                    : $('#cin-ctx-weekend')?.value || 'Weekend Matinee',
            newArrival:
                $('#cin-ctx-newArrival')?.value === '__inherit__'
                    ? null
                    : $('#cin-ctx-newArrival')?.value || 'New Arrival',
            ultra4k:
                $('#cin-ctx-ultra4k')?.value === '__inherit__'
                    ? null
                    : $('#cin-ctx-ultra4k')?.value || '4K Ultra HD',
            priorityOrder: priorityOrderArr,
        };

        const header = {
            enabled: $('#cin-h-enabled')?.checked || false,
            text: $('#cin-h-presets')?.value || 'Now Playing',
            contextHeaders,
            typography: {
                fontFamily: $('#cin-h-font')?.value || 'cinematic',
                fontSize: parseInt($('#cin-h-size')?.value || '100', 10),
                color: $('#cin-h-color')?.value || '#ffffff',
                shadow: $('#cin-h-shadow')?.value || 'subtle',
                textEffect: $('#cin-h-texteffect')?.value || 'none',
                entranceAnimation: $('#cin-h-entrance')?.value || 'none',
                decoration: $('#cin-h-decoration')?.value || 'none',
                tonSurTon: $('#cin-h-tst')?.checked || false,
                tonSurTonIntensity: parseInt($('#cin-h-tst-intensity')?.value || '45', 10),
            },
        };
        const footer = {
            enabled: $('#cin-f-enabled')?.checked || false,
            type: $('#cin-f-type')?.value || 'metadata',
            marqueeText: $('#cin-f-presets')?.value || 'Feature Presentation',
            taglineMarquee: $('#cin-f-tagline-marquee')?.checked || false,
            typography: {
                fontFamily: $('#cin-f-font')?.value || 'system',
                fontSize: parseInt($('#cin-f-size')?.value || '100', 10),
                color: $('#cin-f-color')?.value || '#cccccc',
                shadow: $('#cin-f-shadow')?.value || 'none',
                tonSurTon: $('#cin-f-tst')?.checked || false,
                tonSurTonIntensity: parseInt($('#cin-f-tst-intensity')?.value || '45', 10),
            },
        };
        const ambilight = {
            enabled: $('#cin-a-enabled')?.checked || false,
            strength: parseInt($('#cin-a-strength')?.value || '60', 10),
        };
        // Now Playing settings
        const nowPlaying = {
            enabled: $('#cinemaNowPlayingEnabled')?.checked || false,
        };
        // Orientation from top-level select
        const orientation = $('#cinemaOrientation')?.value || 'auto';
        // Rotation interval from new field
        const rotationIntervalMinutes = parseFloat($('#cinemaRotationInterval')?.value || '0');
        // Presets reflect local working state (system + custom presets combined)
        // Header and footer share the same text presets
        const allTexts = getAllTextPresets();
        const presets = {
            headerTexts: allTexts,
            footerTexts: allTexts,
            customStyles: customPresets || [],
        };

        // Merge enhanced settings (Issue #35)
        const enhanced = collectEnhancedSettings();

        return {
            orientation,
            header,
            footer,
            ambilight,
            nowPlaying,
            rotationIntervalMinutes,
            presets,
            ...enhanced,
        };
    }

    async function init() {
        const cfg = await loadAdminConfig();
        const cm = $('#card-cinema');
        if (!cm) return;
        mountHeader($('#cinema-header-mount'), cfg);
        mountFooter($('#cinema-footer-mount'), cfg);
        // Mount enhanced controls (Issue #35)
        mountEnhancedControls(cfg);
        mountNowPlaying(cfg);
        // Initialize presets functionality (no longer overwrites the HTML mount)
        try {
            const slot = document.getElementById('cinema-presets-mount');
            if (slot) {
                // Wire up presets dropdown and buttons (defined at top of file)
                wirePresets();

                // Add summary section if not present
                if (!document.getElementById('cinema-summary')) {
                    const summaryTitle = document.createElement('div');
                    summaryTitle.className = 'card-title';
                    summaryTitle.style.cssText = 'font-size:.95rem; margin:10px 0 6px;';
                    summaryTitle.innerHTML =
                        '<i class="fas fa-info-circle"></i> Current Experience';

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

                    slot.appendChild(summaryTitle);
                    slot.appendChild(summary);
                }

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
        } catch (_) {
            // presets card mount failed (slot not present)
        }
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
