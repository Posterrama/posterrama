// Preview-only Cinema overlays wiring: renders header/footer/marquee/specs/ambilight based on config
(function () {
    const $ = s => document.querySelector(s);
    function setHeader(text, style, enabled) {
        const el = $('#cinema-header');
        if (!el) return;
        el.className = '';
        el.id = 'cinema-header';
        if (!enabled) {
            el.textContent = '';
            el.style.display = 'none';
            return;
        }
        el.textContent = text || '';
        el.classList.add(`style-${style || 'classic'}`);
        el.style.display = 'flex';
    }
    function setFooterMarquee(text, style) {
        const m = $('#cinema-footer-marquee');
        if (!m) return;
        const span = m.querySelector('span');
        span.textContent = text || '';
        m.className = 'cinema-footer-marquee';
        m.classList.add(`style-${style || 'classic'}`);
        m.style.display = text ? 'block' : 'none';
    }
    function setFooterSpecs(specs) {
        const root = $('#cinema-footer-specs');
        if (!root) return;
        root.innerHTML = '';
        if (!specs) {
            root.style.display = 'none';
            return;
        }
        const { showResolution, showAudio, showAspectRatio, showFlags, style, iconSet } = specs;
        const wrap = document.createElement('div');
        wrap.className = 'specs';
        const chips = [];
        if (showResolution) chips.push({ ico: 'res', label: '4K' });
        if (showAudio) chips.push({ ico: 'aud', label: 'Dolby Atmos' });
        if (showAspectRatio) chips.push({ ico: 'asp', label: '2.39:1' });
        if (showFlags) chips.push({ ico: 'flag', label: 'HDR10+' });
        chips.forEach(c => {
            const chip = document.createElement('span');
            chip.className = 'chip';
            const i = document.createElement('i');
            i.className = `ico ico-${c.ico}`;
            chip.appendChild(i);
            chip.appendChild(document.createTextNode(c.label));
            wrap.appendChild(chip);
        });
        root.appendChild(wrap);
        // style + iconSet
        root.className = '';
        root.id = 'cinema-footer-specs';
        root.classList.add(`style-${style || 'subtle'}`);
        root.classList.add(iconSet === 'line' ? 'icon-line' : 'icon-filled');
        root.style.display = chips.length ? 'block' : 'none';
    }
    function setFooter(type, marqueeText, marqueeStyle, specs, enabled) {
        const root = $('#cinema-footer');
        if (!root) return;
        const marq = $('#cinema-footer-marquee');
        const spec = $('#cinema-footer-specs');
        if (!enabled) {
            root.style.display = 'none';
            return;
        }
        root.style.display = 'block';
        if (type === 'marquee') {
            setFooterMarquee(marqueeText, marqueeStyle);
            marq.style.display = marqueeText ? 'block' : 'none';
            spec.style.display = 'none';
        } else {
            setFooterSpecs(specs);
            marq.style.display = 'none';
            spec.style.display = 'block';
        }
    }
    function setAmbilight(enabled, strength) {
        const a = $('#cinema-ambilight');
        if (!a) return;
        a.style.opacity = enabled ? String(Math.max(0, Math.min(100, strength || 60)) / 100) : '0';
    }
    function applyCinemaOverlays(config) {
        try {
            const c = config && config.cinema ? config.cinema : {};
            setHeader(c.header?.text, c.header?.style, !!c.header?.enabled);
            setFooter(
                c.footer?.type || 'specs',
                c.footer?.marqueeText,
                c.footer?.marqueeStyle,
                c.footer?.specs,
                !!c.footer?.enabled
            );
            setAmbilight(c.ambilight?.enabled !== false, c.ambilight?.strength ?? 60);
        } catch (e) {
            // ignore overlay application errors (preview resilience)
        }
    }
    // On load: if preview sends payload, we listen via script.js->applySettings; else poll initial config
    window.addEventListener('message', ev => {
        try {
            if (ev.origin !== window.location.origin) return;
            if (ev.data && ev.data.type === 'posterrama.preview.update' && ev.data.payload) {
                applyCinemaOverlays(ev.data.payload);
            }
        } catch (_) {
            // ignore malformed post message
        }
    });
    // Also patch into window.applySettings if it exists (for initial boot via preview)
    const prevApply = window.applySettings;
    window.applySettings = function (cfg) {
        try {
            applyCinemaOverlays(cfg);
        } catch (_) {
            // ignore applySettings overlay error
        }
        if (typeof prevApply === 'function') return prevApply.apply(this, arguments);
    };
})();
