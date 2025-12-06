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
            const renderList = () => {
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
                } catch (e) {
                    // ignore preview update failure after add
                }
            };
            const onRename = () => {
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

    // Local working state for presets (kept in-memory until main Save)
    let headerPresets = ['Coming Soon', 'Now Playing', 'Home Cinema', 'Feature Presentation'];
    let footerPresets = ['Coming Soon', 'Now Playing', 'Home Cinema', 'Feature Presentation'];

    function mountHeader(container, cfg) {
        const c = cfg.cinema || {};
        const h = c.header || { enabled: true, text: 'Now Playing', typography: {} };
        const typo = h.typography || {};
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
            el('label', { for: 'cin-h-shadow' }, 'Text Effect'),
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

        // Animation row
        const rowAnim = el('div', { class: 'form-row' }, [
            el('label', { for: 'cin-h-anim' }, 'Animation'),
            el('div', { class: 'select-wrap has-caret' }, [
                el('select', { id: 'cin-h-anim' }, [
                    el('option', { value: 'none' }, 'None'),
                    el('option', { value: 'pulse' }, 'Pulse'),
                    el('option', { value: 'flicker' }, 'Flicker (Neon)'),
                    el('option', { value: 'marquee' }, 'Marquee Scroll'),
                ]),
                el('span', { class: 'select-caret', 'aria-hidden': 'true' }, '▾'),
            ]),
        ]);

        // Decoration row (only shown when animation is 'none')
        const rowDecoration = el('div', { class: 'form-row', id: 'cin-h-decoration-row' }, [
            el('label', { for: 'cin-h-decoration' }, 'Decoration'),
            el('div', { class: 'select-wrap has-caret' }, [
                el('select', { id: 'cin-h-decoration' }, [
                    el('option', { value: 'none' }, 'None'),
                    el('option', { value: 'frame' }, 'Frame'),
                    el('option', { value: 'underline' }, 'Underline'),
                    el('option', { value: 'backdrop' }, 'Backdrop'),
                ]),
                el('span', { class: 'select-caret', 'aria-hidden': 'true' }, '▾'),
            ]),
        ]);

        const grid = el('div', { class: 'form-grid' }, [
            rowText,
            typoHeader,
            rowFont,
            rowSize,
            rowTonSurTon,
            rowTstIntensity,
            rowColor,
            rowShadow,
            rowAnim,
            rowDecoration,
        ]);
        container.replaceChildren(grid);

        // Initialize values
        $('#cin-h-font').value = typo.fontFamily || 'cinematic';
        $('#cin-h-shadow').value = typo.shadow || 'subtle';
        $('#cin-h-anim').value = typo.animation || 'none';
        $('#cin-h-decoration').value = typo.decoration || 'none';
        $('#cin-h-tst').checked = typo.tonSurTon || false;
        $('#cin-h-tst-intensity').value = typo.tonSurTonIntensity || 45;

        // Wire decoration visibility based on animation
        const decorationRow = document.getElementById('cin-h-decoration-row');
        const animSelect = document.getElementById('cin-h-anim');
        const decorationSelect = document.getElementById('cin-h-decoration');
        const shadowRow = document.getElementById('cin-h-shadow')?.closest('.form-row');

        const syncDecorationVisibility = () => {
            const isNoAnim = animSelect?.value === 'none';
            if (decorationRow) decorationRow.style.display = isNoAnim ? '' : 'none';
        };

        const syncShadowVisibility = () => {
            // Shadow is always visible for all decorations
            if (shadowRow) shadowRow.style.display = '';
        };

        animSelect?.addEventListener('change', () => {
            syncDecorationVisibility();
            syncShadowVisibility();
        });
        decorationSelect?.addEventListener('change', syncShadowVisibility);
        syncDecorationVisibility();
        syncShadowVisibility();

        // Initialize header text preset
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
            // footer toggle mount failure ignored (card not yet in DOM)
            void 0;
        }

        // Footer type row
        const ctrlType = el('div', { class: 'form-row' }, [
            el('label', { for: 'cin-f-type' }, 'Footer type'),
            el('div', { class: 'select-wrap has-caret' }, [
                el('select', { id: 'cin-f-type' }, [
                    el('option', { value: 'marquee' }, 'Marquee Text'),
                    el('option', { value: 'metadata' }, 'Metadata & Specs'),
                    el('option', { value: 'tagline' }, 'Movie Tagline'),
                ]),
                el('span', { class: 'select-caret', 'aria-hidden': 'true' }, '▾'),
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

        // === Tagline Block (just shows movie tagline, no config needed) ===
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
            const desired =
                wsF.footer?.marqueeText && footerPresets.includes(wsF.footer.marqueeText)
                    ? wsF.footer.marqueeText
                    : footerPresets.includes(savedMarqueeText)
                      ? savedMarqueeText
                      : footerPresets[0];
            populateSimpleSelect(sel, footerPresets, desired);
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
            } catch (e) {
                // ignore preview update failure
                void e;
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

        // Global Effects controls
        const globalEffects = c.globalEffects || {};
        $('#cinemaColorFilter') &&
            ($('#cinemaColorFilter').value = globalEffects.colorFilter || 'none');
        $('#cinemaContrast') && ($('#cinemaContrast').value = globalEffects.contrast || 100);
        $('#cinemaBrightness') && ($('#cinemaBrightness').value = globalEffects.brightness || 100);
        $('#cinemaHideAllUI') && ($('#cinemaHideAllUI').checked = !!globalEffects.hideAllUI);

        // Quick Theme - restore selection
        if ($('#cinemaQuickTheme') && c.quickTheme) {
            $('#cinemaQuickTheme').value = c.quickTheme;
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
        $('#cinemaPosterAnimation') &&
            ($('#cinemaPosterAnimation').value = poster.animation || 'fade');
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
                    initFallbackColorPickers(bg, poster);
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
    }

    // Fallback color pickers when createColorPicker is not available
    function initFallbackColorPickers(bg, poster) {
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
    }

    function wireModernSliders() {
        // Wire up modern sliders with fill bar animation (like Wallart)
        const sliders = [
            { id: 'cin-h-size', suffix: '%', min: 50, max: 200 },
            { id: 'cin-f-size', suffix: '%', min: 50, max: 200 },
            { id: 'cin-h-tst-intensity', suffix: '%', min: 10, max: 100 },
            { id: 'cin-f-tst-intensity', suffix: '%', min: 10, max: 100 },
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

        // Quick Theme: apply preset combinations
        wireQuickThemes();
    }

    // === Quick Theme Presets ===
    const QUICK_THEMES = {
        classicCinema: {
            label: 'Classic Cinema',
            poster: { style: 'shadowBox', overlay: 'none', frameColor: '#222222' },
            background: { mode: 'gradient', vignette: 'subtle' },
            globalEffects: { colorFilter: 'none', contrast: 100, brightness: 100 },
        },
        noir: {
            label: 'Noir',
            poster: { style: 'framed', overlay: 'grain', frameColor: '#444444' },
            background: { mode: 'solid', solidColor: '#0a0a0a', vignette: 'dramatic' },
            globalEffects: { colorFilter: 'sepia', contrast: 120, brightness: 90 },
        },
        neonNights: {
            label: 'Neon Nights',
            poster: { style: 'neon', overlay: 'none', frameColor: '#ff00ff' },
            background: { mode: 'starfield', vignette: 'none' },
            globalEffects: { colorFilter: 'cool', contrast: 110, brightness: 100 },
        },
        vintageTheater: {
            label: 'Vintage Theater',
            poster: { style: 'ornate', overlay: 'none', frameColor: '#8b4513' },
            background: { mode: 'curtain', vignette: 'subtle' },
            globalEffects: { colorFilter: 'warm', contrast: 105, brightness: 95 },
        },
        modernMinimal: {
            label: 'Modern Minimal',
            poster: { style: 'fullBleed', overlay: 'none' },
            background: { mode: 'solid', solidColor: '#000000', vignette: 'none' },
            globalEffects: { colorFilter: 'none', contrast: 100, brightness: 100 },
        },
        filmProjector: {
            label: 'Film Projector',
            poster: { style: 'floating', overlay: 'oldMovie' },
            background: { mode: 'blurred', vignette: 'dramatic' },
            globalEffects: { colorFilter: 'sepia', contrast: 110, brightness: 95 },
        },
    };

    function wireQuickThemes() {
        const themeSelect = $('#cinemaQuickTheme');
        if (!themeSelect) return;

        themeSelect.addEventListener('change', () => {
            const themeKey = themeSelect.value;
            if (!themeKey || !QUICK_THEMES[themeKey]) return;

            const theme = QUICK_THEMES[themeKey];

            // Apply poster settings
            if (theme.poster) {
                const posterStyleSelect = $('#cinemaPosterStyle');
                const posterOverlaySelect = $('#cinemaPosterOverlay');
                if (posterStyleSelect && theme.poster.style) {
                    posterStyleSelect.value = theme.poster.style;
                    posterStyleSelect.dispatchEvent(new Event('change'));
                }
                if (posterOverlaySelect && theme.poster.overlay) {
                    posterOverlaySelect.value = theme.poster.overlay;
                }
                if (theme.poster.frameColor) {
                    const frameColorInput = $('#cinemaFrameColor');
                    const frameColorModeSelect = $('#cinemaFrameColorMode');
                    if (frameColorInput) frameColorInput.value = theme.poster.frameColor;
                    // Reset to custom mode when applying theme with custom color
                    if (frameColorModeSelect) {
                        frameColorModeSelect.value = 'custom';
                        frameColorModeSelect.dispatchEvent(new Event('change'));
                    }
                }
            }

            // Apply background settings
            if (theme.background) {
                const bgModeSelect = $('#cinemaBackgroundMode');
                const vignetteSelect = $('#cinemaVignette');
                const bgColorInput = $('#cinemaBackgroundColor');
                if (bgModeSelect && theme.background.mode) {
                    bgModeSelect.value = theme.background.mode;
                    bgModeSelect.dispatchEvent(new Event('change'));
                }
                if (vignetteSelect && theme.background.vignette) {
                    vignetteSelect.value = theme.background.vignette;
                }
                if (bgColorInput && theme.background.solidColor) {
                    bgColorInput.value = theme.background.solidColor;
                }
            }

            // Apply global effects
            if (theme.globalEffects) {
                const colorFilterSelect = $('#cinemaColorFilter');
                const contrastSlider = $('#cinemaContrast');
                const brightnessSlider = $('#cinemaBrightness');
                if (colorFilterSelect && theme.globalEffects.colorFilter) {
                    colorFilterSelect.value = theme.globalEffects.colorFilter;
                    colorFilterSelect.dispatchEvent(new Event('change'));
                }
                if (contrastSlider && theme.globalEffects.contrast) {
                    contrastSlider.value = theme.globalEffects.contrast;
                    contrastSlider.dispatchEvent(new Event('input'));
                }
                if (brightnessSlider && theme.globalEffects.brightness) {
                    brightnessSlider.value = theme.globalEffects.brightness;
                    brightnessSlider.dispatchEvent(new Event('input'));
                }
            }

            // Keep selected theme visible (don't reset to placeholder)
        });
    }

    // === NEW: Collect enhanced settings for save ===
    function collectEnhancedSettings() {
        return {
            poster: {
                style: $('#cinemaPosterStyle')?.value || 'floating',
                overlay: $('#cinemaPosterOverlay')?.value || 'none',
                animation: $('#cinemaPosterAnimation')?.value || 'fade',
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
            },
            quickTheme: $('#cinemaQuickTheme')?.value || '',
        };
    }

    function collectCinemaOnly(baseCfg) {
        const cfg = baseCfg || {};
        const header = {
            enabled: $('#cin-h-enabled')?.checked || false,
            text: $('#cin-h-presets')?.value || 'Now Playing',
            typography: {
                fontFamily: $('#cin-h-font')?.value || 'cinematic',
                fontSize: parseInt($('#cin-h-size')?.value || '100', 10),
                color: $('#cin-h-color')?.value || '#ffffff',
                shadow: $('#cin-h-shadow')?.value || 'subtle',
                animation: $('#cin-h-anim')?.value || 'none',
                decoration: $('#cin-h-decoration')?.value || 'none',
                tonSurTon: $('#cin-h-tst')?.checked || false,
                tonSurTonIntensity: parseInt($('#cin-h-tst-intensity')?.value || '45', 10),
            },
        };
        const footer = {
            enabled: $('#cin-f-enabled')?.checked || false,
            type: $('#cin-f-type')?.value || 'metadata',
            marqueeText: $('#cin-f-presets')?.value || 'Feature Presentation',
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
        // Orientation from top-level select
        const orientation = $('#cinemaOrientation')?.value || 'auto';
        // Rotation interval from new field
        const rotationIntervalMinutes = parseFloat($('#cinemaRotationInterval')?.value || '0');
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

        // Merge enhanced settings (Issue #35)
        const enhanced = collectEnhancedSettings();

        return {
            orientation,
            header,
            footer,
            ambilight,
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
                    '<button type="button" class="btn btn-secondary btn-sm" data-cin-preset="classic" title="Classic cinema experience"><i class="fas fa-film"></i> <span>Classic</span></button>',
                    '<button type="button" class="btn btn-secondary btn-sm" data-cin-preset="modern" title="Clean modern look"><i class="fas fa-tv"></i> <span>Modern</span></button>',
                    '<button type="button" class="btn btn-secondary btn-sm" data-cin-preset="premiere" title="Red carpet premiere feel"><i class="fas fa-star"></i> <span>Premiere</span></button>',
                    '<button type="button" class="btn btn-secondary btn-sm" data-cin-preset="imax" title="IMAX-inspired immersive"><i class="fas fa-expand"></i> <span>IMAX</span></button>',
                    '<button type="button" class="btn btn-secondary btn-sm" data-cin-preset="minimal" title="Minimal distraction"><i class="fas fa-minus"></i> <span>Minimal</span></button>',
                    '<button type="button" class="btn btn-secondary btn-sm" data-cin-preset="neon" title="Retro neon vibes"><i class="fas fa-bolt"></i> <span>Neon</span></button>',
                    '<button type="button" class="btn btn-secondary btn-sm" data-cin-preset="elegant" title="Elegant and refined"><i class="fas fa-gem"></i> <span>Elegant</span></button>',
                    '<button type="button" class="btn btn-secondary btn-sm" data-cin-preset="retro" title="Vintage cinema feel"><i class="fas fa-ticket-alt"></i> <span>Retro</span></button>',
                    '<button type="button" class="btn btn-secondary btn-sm" data-cin-preset="showcase" title="Full metadata showcase"><i class="fas fa-info-circle"></i> <span>Showcase</span></button>',
                    '<button type="button" class="btn btn-secondary btn-sm" data-cin-preset="dark" title="Dark ambient mode"><i class="fas fa-moon"></i> <span>Dark</span></button>',
                    '<button type="button" class="btn btn-secondary btn-sm" data-cin-preset="lobby" title="Cinema lobby display"><i class="fas fa-door-open"></i> <span>Lobby</span></button>',
                    '<button type="button" class="btn btn-secondary btn-sm" data-cin-preset="techspec" title="Technical specifications"><i class="fas fa-microchip"></i> <span>Tech Spec</span></button>',
                    '<button type="button" class="btn btn-outline btn-sm" data-cin-preset="reset" title="Reset to defaults"><i class="fas fa-undo"></i> <span>Reset</span></button>',
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

                // removed unused helper q (was const q = sel => document.querySelector(sel))
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
                    // Helper to set metadata toggles
                    const setMeta = show => {
                        setVal('cinemaShowYear', show.year !== false);
                        setVal('cinemaShowRuntime', show.runtime !== false);
                        setVal('cinemaShowRating', show.rating !== false);
                        setVal('cinemaShowCertification', !!show.certification);
                        setVal('cinemaShowGenre', !!show.genre);
                        setVal('cinemaShowDirector', !!show.director);
                        setVal('cinemaShowStudioLogo', !!show.studio);
                    };
                    const setSpecs = show => {
                        setVal('cinemaShowResolution', show.resolution !== false);
                        setVal('cinemaShowAudio', show.audio !== false);
                        setVal('cinemaShowHDR', show.hdr !== false);
                        setVal('cinemaShowAspectRatio', !!show.aspectRatio);
                    };
                    const setBackground = (mode, color) => {
                        setVal('cinemaBackgroundMode', mode || 'solid');
                        if (color) {
                            const bgInput = document.getElementById('cinemaBackgroundColor');
                            if (bgInput) bgInput.value = color;
                        }
                    };
                    const setPoster = (style, anim) => {
                        setVal('cinemaPosterStyle', style || 'floating');
                        setVal('cinemaPosterAnimation', anim || 'fade');
                    };

                    switch (name) {
                        case 'classic':
                            // Classic cinema: gold header, marquee footer, warm ambilight
                            setVal('cin-a-enabled', true);
                            setVal('cin-a-strength', 55);
                            setVal('cin-h-enabled', true);
                            setVal('cin-h-presets', 'Now Playing');
                            setVal('cin-h-font', 'cinematic');
                            setVal('cin-h-size', 110);
                            setVal('cin-h-color', '#ffd700');
                            setVal('cin-h-shadow', 'glow');
                            setVal('cin-h-anim', 'none');
                            setVal('cin-f-enabled', true);
                            setVal('cin-f-type', 'marquee');
                            document
                                .getElementById('cin-f-type')
                                ?.dispatchEvent(new Event('change', { bubbles: true }));
                            setVal('cin-f-presets', 'Feature Presentation');
                            setVal('cin-f-font', 'cinematic');
                            setVal('cin-f-color', '#ffffff');
                            setVal('cin-f-shadow', 'subtle');
                            setBackground('solid', '#000000');
                            setPoster('floating', 'fade');
                            setMeta({ title: true, year: true, runtime: true, rating: true });
                            setSpecs({ resolution: true, audio: true, hdr: true });
                            setVal('cinemaSpecsStyle', 'icons-text');
                            break;

                        case 'modern':
                            // Modern clean: white text, minimal, blurred background
                            setVal('cin-a-enabled', true);
                            setVal('cin-a-strength', 40);
                            setVal('cin-h-enabled', true);
                            setVal('cin-h-presets', 'Now Playing');
                            setVal('cin-h-font', 'modern');
                            setVal('cin-h-size', 100);
                            setVal('cin-h-color', '#ffffff');
                            setVal('cin-h-shadow', 'subtle');
                            setVal('cin-h-anim', 'none');
                            setVal('cin-f-enabled', true);
                            setVal('cin-f-type', 'metadata');
                            document
                                .getElementById('cin-f-type')
                                ?.dispatchEvent(new Event('change', { bubbles: true }));
                            setVal('cin-f-font', 'modern');
                            setVal('cin-f-color', '#e0e0e0');
                            setBackground('blurred', '#1a1a2e');
                            setPoster('floating', 'fade');
                            setMeta({ title: true, year: true, runtime: true, rating: true });
                            setSpecs({ resolution: true, audio: true, hdr: true });
                            setVal('cinemaSpecsStyle', 'dark-glass');
                            break;

                        case 'premiere':
                            // Red carpet premiere: bold red accents, dramatic
                            setVal('cin-a-enabled', true);
                            setVal('cin-a-strength', 70);
                            setVal('cin-h-enabled', true);
                            setVal('cin-h-presets', 'Feature Presentation');
                            setVal('cin-h-font', 'elegant');
                            setVal('cin-h-size', 120);
                            setVal('cin-h-color', '#ff3333');
                            setVal('cin-h-shadow', 'dramatic');
                            setVal('cin-h-anim', 'none');
                            setVal('cin-f-enabled', true);
                            setVal('cin-f-type', 'tagline');
                            document
                                .getElementById('cin-f-type')
                                ?.dispatchEvent(new Event('change', { bubbles: true }));
                            setVal('cin-f-font', 'elegant');
                            setVal('cin-f-color', '#cccccc');
                            setBackground('curtain', '#0a0a0a');
                            setPoster('doubleBorder', 'cinematic');
                            setVal('cinemaFrameColor', '#cc0000');
                            setMeta({
                                title: true,
                                year: true,
                                runtime: true,
                                rating: true,
                                director: true,
                            });
                            setSpecs({
                                resolution: true,
                                audio: true,
                                hdr: true,
                                aspectRatio: true,
                            });
                            setVal('cinemaSpecsStyle', 'glass');
                            break;

                        case 'imax':
                            // IMAX immersive: full specs, strong ambilight, cinematic
                            setVal('cin-a-enabled', true);
                            setVal('cin-a-strength', 85);
                            setVal('cin-h-enabled', true);
                            setVal('cin-h-presets', 'Home Cinema');
                            setVal('cin-h-font', 'cinematic');
                            setVal('cin-h-size', 130);
                            setVal('cin-h-color', '#3399ff');
                            setVal('cin-h-shadow', 'glow');
                            setVal('cin-h-anim', 'none');
                            setVal('cin-f-enabled', true);
                            setVal('cin-f-type', 'metadata');
                            document
                                .getElementById('cin-f-type')
                                ?.dispatchEvent(new Event('change', { bubbles: true }));
                            setVal('cin-f-font', 'modern');
                            setVal('cin-f-color', '#ffffff');
                            setBackground('spotlight', '#000000');
                            setPoster('floating', 'zoomIn');
                            setMeta({ title: true, year: true, runtime: true, rating: true });
                            setSpecs({
                                resolution: true,
                                audio: true,
                                hdr: true,
                                aspectRatio: true,
                            });
                            setVal('cinemaSpecsStyle', 'icons-only');
                            setVal('cinemaSpecsIconSet', 'tabler');
                            break;

                        case 'minimal':
                            // Minimal: poster only, subtle ambilight, no text overlays
                            setVal('cin-a-enabled', true);
                            setVal('cin-a-strength', 30);
                            setVal('cin-h-enabled', false);
                            setVal('cin-f-enabled', false);
                            setBackground('solid', '#000000');
                            setPoster('floating', 'fade');
                            setMeta({});
                            setSpecs({});
                            break;

                        case 'neon':
                            // Neon retro: vibrant colors, neon glow effects
                            setVal('cin-a-enabled', true);
                            setVal('cin-a-strength', 65);
                            setVal('cin-h-enabled', true);
                            setVal('cin-h-presets', 'Now Playing');
                            setVal('cin-h-font', 'neon');
                            setVal('cin-h-size', 110);
                            setVal('cin-h-color', '#ff00ff');
                            setVal('cin-h-shadow', 'neon');
                            setVal('cin-h-anim', 'pulse');
                            setVal('cin-f-enabled', true);
                            setVal('cin-f-type', 'marquee');
                            document
                                .getElementById('cin-f-type')
                                ?.dispatchEvent(new Event('change', { bubbles: true }));
                            setVal('cin-f-presets', 'Feature Presentation');
                            setVal('cin-f-font', 'neon');
                            setVal('cin-f-color', '#00ffff');
                            setVal('cin-f-shadow', 'neon');
                            setBackground('starfield', '#000000');
                            setPoster('neon', 'fade');
                            setVal('cinemaFrameColor', '#ff00ff');
                            setMeta({ title: true, year: true, rating: true });
                            setSpecs({ resolution: true, audio: true, hdr: true });
                            setVal('cinemaSpecsStyle', 'badges');
                            break;

                        case 'elegant':
                            // Elegant: serif fonts, refined, sophisticated
                            setVal('cin-a-enabled', true);
                            setVal('cin-a-strength', 45);
                            setVal('cin-h-enabled', true);
                            setVal('cin-h-presets', 'Now Playing');
                            setVal('cin-h-font', 'elegant');
                            setVal('cin-h-size', 105);
                            setVal('cin-h-color', '#c0c0c0');
                            setVal('cin-h-shadow', 'subtle');
                            setVal('cin-h-anim', 'none');
                            setVal('cin-f-enabled', true);
                            setVal('cin-f-type', 'tagline');
                            document
                                .getElementById('cin-f-type')
                                ?.dispatchEvent(new Event('change', { bubbles: true }));
                            setVal('cin-f-font', 'elegant');
                            setVal('cin-f-color', '#a0a0a0');
                            setBackground('gradient', '#1a1a1a');
                            setPoster('shadowBox', 'fade');
                            setVal('cinemaFrameColor', '#333333');
                            setMeta({
                                title: true,
                                year: true,
                                runtime: true,
                                rating: true,
                                director: true,
                            });
                            setSpecs({ resolution: true, audio: true });
                            setVal('cinemaSpecsStyle', 'subtle');
                            break;

                        case 'retro':
                            // Retro: vintage cinema, marquee style, warm tones
                            setVal('cin-a-enabled', true);
                            setVal('cin-a-strength', 50);
                            setVal('cin-h-enabled', true);
                            setVal('cin-h-presets', 'Coming Soon');
                            setVal('cin-h-font', 'retro');
                            setVal('cin-h-size', 100);
                            setVal('cin-h-color', '#ffcc00');
                            setVal('cin-h-shadow', 'dramatic');
                            setVal('cin-h-anim', 'flicker');
                            setVal('cin-f-enabled', true);
                            setVal('cin-f-type', 'marquee');
                            document
                                .getElementById('cin-f-type')
                                ?.dispatchEvent(new Event('change', { bubbles: true }));
                            setVal('cin-f-presets', 'Feature Presentation');
                            setVal('cin-f-font', 'retro');
                            setVal('cin-f-color', '#ffaa00');
                            setBackground('curtain', '#0d0d0d');
                            setPoster('ornate', 'slideUp');
                            setVal('cinemaFrameColor', '#8b4513');
                            setMeta({ title: true, year: true, runtime: true });
                            setSpecs({ resolution: true, audio: true });
                            setVal('cinemaSpecsStyle', 'badges');
                            break;

                        case 'showcase':
                            // Showcase: maximum metadata, everything visible
                            setVal('cin-a-enabled', true);
                            setVal('cin-a-strength', 50);
                            setVal('cin-h-enabled', true);
                            setVal('cin-h-presets', 'Now Playing');
                            setVal('cin-h-font', 'cinematic');
                            setVal('cin-h-size', 100);
                            setVal('cin-h-color', '#ffffff');
                            setVal('cin-h-shadow', 'subtle');
                            setVal('cin-f-enabled', true);
                            setVal('cin-f-type', 'metadata');
                            document
                                .getElementById('cin-f-type')
                                ?.dispatchEvent(new Event('change', { bubbles: true }));
                            setVal('cin-f-font', 'system');
                            setVal('cin-f-color', '#cccccc');
                            setBackground('blurred', '#000000');
                            setPoster('floating', 'fade');
                            setMeta({
                                title: true,
                                year: true,
                                runtime: true,
                                rating: true,
                                certification: true,
                                genre: true,
                                director: true,
                                cast: true,
                                plot: true,
                            });
                            setSpecs({
                                resolution: true,
                                audio: true,
                                hdr: true,
                                aspectRatio: true,
                            });
                            setVal('cinemaSpecsStyle', 'badges');
                            break;

                        case 'dark':
                            // Dark ambient: subtle, low contrast, relaxing
                            setVal('cin-a-enabled', true);
                            setVal('cin-a-strength', 25);
                            setVal('cin-h-enabled', true);
                            setVal('cin-h-presets', 'Now Playing');
                            setVal('cin-h-font', 'system');
                            setVal('cin-h-size', 90);
                            setVal('cin-h-color', '#666666');
                            setVal('cin-h-shadow', 'none');
                            setVal('cin-h-anim', 'none');
                            setVal('cin-f-enabled', true);
                            setVal('cin-f-type', 'metadata');
                            document
                                .getElementById('cin-f-type')
                                ?.dispatchEvent(new Event('change', { bubbles: true }));
                            setVal('cin-f-font', 'system');
                            setVal('cin-f-color', '#555555');
                            setBackground('solid', '#000000');
                            setPoster('floating', 'fade');
                            setMeta({ title: true, year: true });
                            setSpecs({ resolution: true, audio: true });
                            setVal('cinemaSpecsStyle', 'subtle');
                            break;

                        case 'lobby':
                            // Lobby display: bright, informative, eye-catching
                            setVal('cin-a-enabled', true);
                            setVal('cin-a-strength', 60);
                            setVal('cin-h-enabled', true);
                            setVal('cin-h-presets', 'Coming Soon');
                            setVal('cin-h-font', 'marquee');
                            setVal('cin-h-size', 115);
                            setVal('cin-h-color', '#ff6b6b');
                            setVal('cin-h-shadow', 'dramatic');
                            setVal('cin-h-anim', 'marquee');
                            setVal('cin-f-enabled', true);
                            setVal('cin-f-type', 'metadata');
                            document
                                .getElementById('cin-f-type')
                                ?.dispatchEvent(new Event('change', { bubbles: true }));
                            setVal('cin-f-font', 'modern');
                            setVal('cin-f-color', '#ffffff');
                            setBackground('gradient', '#1a1a2e');
                            setPoster('floating', 'zoomIn');
                            setMeta({
                                title: true,
                                year: true,
                                runtime: true,
                                rating: true,
                                genre: true,
                            });
                            setSpecs({ resolution: true, audio: true, hdr: true });
                            setVal('cinemaSpecsStyle', 'badges');
                            break;

                        case 'techspec':
                            // Technical specifications: all specs, minimal else
                            setVal('cin-a-enabled', false);
                            setVal('cin-h-enabled', false);
                            setVal('cin-f-enabled', true);
                            setVal('cin-f-type', 'metadata');
                            document
                                .getElementById('cin-f-type')
                                ?.dispatchEvent(new Event('change', { bubbles: true }));
                            setVal('cin-f-font', 'modern');
                            setVal('cin-f-color', '#00ff00');
                            setBackground('solid', '#000000');
                            setPoster('floating', 'fade');
                            setMeta({ title: true, year: true });
                            setSpecs({
                                resolution: true,
                                audio: true,
                                hdr: true,
                                aspectRatio: true,
                            });
                            setVal('cinemaSpecsStyle', 'icons');
                            setVal('cinemaSpecsIconSet', 'tabler');
                            break;

                        default:
                            // === FULL RESET TO CLEAN DEFAULTS ===
                            // Goal: Full-bleed poster, normal colors, no effects, all metadata on

                            // Global Effects - all off/neutral
                            setVal('cinemaColorFilter', 'none');
                            setVal('cinemaContrast', 100);
                            setVal('cinemaBrightness', 100);
                            setVal('cinemaHideAllUI', false);
                            // Reset tint color if exists
                            {
                                const tintInput = document.getElementById('cinemaTintColor');
                                if (tintInput) tintInput.value = '#ff6b35';
                            }

                            // Quick Theme - none selected
                            setVal('cinemaQuickTheme', '');

                            // Ambilight - subtle
                            setVal('cin-a-enabled', true);
                            setVal('cin-a-strength', 50);

                            // Header - silver color, cinematic font, 150% size
                            setVal('cin-h-enabled', true);
                            setVal('cin-h-presets', 'Now Playing');
                            setVal('cin-h-font', 'cinematic');
                            setVal('cin-h-size', 150);
                            setVal('cin-h-color', '#C0C0C0');
                            setVal('cin-h-shadow', 'subtle');
                            setVal('cin-h-anim', 'none');
                            setVal('cin-h-tst', false); // ton-sur-ton off
                            setVal('cin-h-tst-intensity', 45); // default intensity
                            // Show header color picker, hide intensity slider
                            {
                                const hColorRow = document
                                    .getElementById('cin-h-color')
                                    ?.closest('.cin-row');
                                if (hColorRow) hColorRow.style.display = '';
                                const hIntensityRow =
                                    document.getElementById('cin-h-tst-intensity-row');
                                if (hIntensityRow) hIntensityRow.style.display = 'none';
                            }

                            // Footer - metadata type, system font, silver color, 150% size
                            setVal('cin-f-enabled', true);
                            setVal('cin-f-type', 'metadata');
                            document
                                .getElementById('cin-f-type')
                                ?.dispatchEvent(new Event('change', { bubbles: true }));
                            setVal('cin-f-font', 'system');
                            setVal('cin-f-size', 150);
                            setVal('cin-f-color', '#C0C0C0');
                            setVal('cin-f-shadow', 'none');
                            setVal('cin-f-tst', false); // ton-sur-ton off
                            setVal('cin-f-tst-intensity', 45); // default intensity
                            // Show footer color picker, hide intensity slider
                            {
                                const fColorRow = document
                                    .getElementById('cin-f-color')
                                    ?.closest('.cin-row');
                                if (fColorRow) fColorRow.style.display = '';
                                const fIntensityRow =
                                    document.getElementById('cin-f-tst-intensity-row');
                                if (fIntensityRow) fIntensityRow.style.display = 'none';
                            }

                            // Background - solid black, no blur, subtle vignette
                            setBackground('solid', '#000000');
                            setVal('cinemaBackgroundBlur', 20);
                            setVal('cinemaVignette', 'subtle');

                            // Poster - full bleed (floating), no frame effects
                            setVal('cinemaPosterStyle', 'floating');
                            setVal('cinemaPosterOverlay', 'none');
                            setVal('cinemaPosterAnimation', 'fade');
                            setVal('cinemaPosterTransition', 1.5);
                            setVal('cinemaFrameWidth', 8);
                            setVal('cinemaFrameColorMode', 'custom');
                            // Reset frame color
                            {
                                const frameInput = document.getElementById('cinemaFrameColor');
                                if (frameInput) frameInput.value = '#ffffff';
                                // Update visibility
                                const frameColorModeSelect =
                                    document.getElementById('cinemaFrameColorMode');
                                if (frameColorModeSelect) {
                                    frameColorModeSelect.dispatchEvent(new Event('change'));
                                }
                            }

                            // Metadata - ALL ON for full info display
                            setMeta({
                                title: true,
                                year: true,
                                runtime: true,
                                rating: true,
                                certification: true,
                                genre: true,
                                director: true,
                                studio: true,
                            });
                            setVal('cinemaMetadataLayout', 'comfortable');
                            setVal('cinemaMetadataOpacity', 80);

                            // Specs - all on with badges style
                            setSpecs({
                                resolution: true,
                                audio: true,
                                hdr: true,
                                aspectRatio: true,
                            });
                            setVal('cinemaSpecsStyle', 'badges');
                            setVal('cinemaSpecsIconSet', 'tabler');

                            // Promotional - all off for clean look
                            setVal('cinemaRatingBadge', false);
                            setVal('cinemaWatchProviders', false);
                            setVal('cinemaAwardsBadge', false);
                            setVal('cinemaQREnabled', false);
                            // Hide QR settings
                            {
                                const qrSettings = document.getElementById('cinemaQRSettings');
                                if (qrSettings) qrSettings.style.display = 'none';
                            }
                    }
                    try {
                        window.__displayPreviewInit && (window.__forcePreviewUpdate?.() || 0);
                    } catch (e) {
                        // preset apply side-effect refresh failed (non-fatal)
                    }
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
