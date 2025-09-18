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
        headerPresets =
            Array.isArray(c.presets?.headerTexts) && c.presets.headerTexts.length
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
        $('#cin-h-presets').value = headerPresets.includes(h.text) ? h.text : headerPresets[0];
        const syncHeaderPresetSelect = () => {
            const sel = $('#cin-h-presets');
            const options = [
                ...headerPresets.map(p => el('option', { value: p }, p)),
                el('option', { disabled: '', value: '' }, '──────────'),
                el('option', { value: '__add' }, '➕ Add new…'),
                el('option', { value: '__rename' }, '✏️ Rename selected…'),
                el('option', { value: '__delete' }, '🗑 Delete selected…'),
            ];
            sel.replaceChildren(...options);
            const cur = $('#cin-h-presets').value;
            sel.value = headerPresets.includes(cur) ? cur : headerPresets[0] || '';
        };
        syncHeaderPresetSelect();
        $('#cin-h-presets').addEventListener('change', () => {
            const v = $('#cin-h-presets').value;
            if (v === '__add') {
                const name = prompt('New header preset text');
                const val = (name || '').trim();
                if (val && !headerPresets.includes(val)) headerPresets.push(val);
                if (val) $('#cin-h-presets').value = val;
                syncHeaderPresetSelect();
                return;
            }
            if (v === '__rename') {
                const sel = $('#cin-h-presets');
                const current =
                    sel.value && !sel.options[sel.selectedIndex].disabled ? sel.value : '';
                const renamed = prompt('Rename header preset', current);
                const rv = (renamed || '').trim();
                const i = headerPresets.indexOf(current);
                if (rv && i >= 0) headerPresets[i] = rv;
                if (rv) $('#cin-h-presets').value = rv;
                syncHeaderPresetSelect();
                return;
            }
            if (v === '__delete') {
                const current = $('#cin-h-presets').value || '';
                headerPresets = headerPresets.filter(x => x !== current);
                syncHeaderPresetSelect();
                return;
            }
            // selecting a normal option is enough
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
        footerPresets =
            Array.isArray(c.presets?.footerTexts) && c.presets.footerTexts.length
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
        const syncFooterPresetSelect = () => {
            const sel = $('#cin-f-presets');
            const options = [
                ...footerPresets.map(p => el('option', { value: p }, p)),
                el('option', { disabled: '', value: '' }, '──────────'),
                el('option', { value: '__add' }, '➕ Add new…'),
                el('option', { value: '__rename' }, '✏️ Rename selected…'),
                el('option', { value: '__delete' }, '🗑 Delete selected…'),
            ];
            sel.replaceChildren(...options);
            // On first run, prefer saved value; afterwards preserve current selection
            if (!sel.dataset.init) {
                const desired = footerPresets.includes(savedMarqueeText)
                    ? savedMarqueeText
                    : footerPresets[0] || '';
                sel.value = desired;
                sel.dataset.init = '1';
            } else {
                const cur = sel.value;
                sel.value = footerPresets.includes(cur) ? cur : footerPresets[0] || '';
            }
        };
        syncFooterPresetSelect();
        $('#cin-f-presets').addEventListener('change', () => {
            const v = $('#cin-f-presets').value;
            if (v === '__add') {
                const name = prompt('New footer preset text');
                const val = (name || '').trim();
                if (val && !footerPresets.includes(val)) footerPresets.push(val);
                if (val) $('#cin-f-presets').value = val;
                syncFooterPresetSelect();
                return;
            }
            if (v === '__rename') {
                const sel = $('#cin-f-presets');
                const current =
                    sel.value && !sel.options[sel.selectedIndex].disabled ? sel.value : '';
                const renamed = prompt('Rename footer preset', current);
                const rv = (renamed || '').trim();
                const i = footerPresets.indexOf(current);
                if (rv && i >= 0) footerPresets[i] = rv;
                if (rv) $('#cin-f-presets').value = rv;
                syncFooterPresetSelect();
                return;
            }
            if (v === '__delete') {
                const current = $('#cin-f-presets').value || '';
                footerPresets = footerPresets.filter(x => x !== current);
                syncFooterPresetSelect();
                return;
            }
            // selecting a normal option is enough
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
