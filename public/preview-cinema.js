// Preview-only Cinema overlays wiring: renders header/footer/marquee/specs/ambilight based on config
(function () {
    const $ = s => document.querySelector(s);

    function hideCinemaUnwantedElements(isCinemaMode) {
        // In cinema mode: hide metadata, clearlogo, RT badge (match real cinema.html behavior)
        const textWrapper = $('#text-wrapper');
        const clearlogoContainer = $('#clearlogo-container');
        const rtBadge = $('#rt-badge');

        if (isCinemaMode) {
            if (textWrapper) textWrapper.style.display = 'none';
            if (clearlogoContainer) clearlogoContainer.style.display = 'none';
            if (rtBadge) rtBadge.style.display = 'none';
        } else {
            // Restore for other modes
            if (textWrapper) textWrapper.style.display = '';
            if (clearlogoContainer) clearlogoContainer.style.display = '';
            if (rtBadge) rtBadge.style.display = '';
        }
    }

    function setHeader(text, style, enabled) {
        const el = $('#cinema-header');
        const body = document.body;
        if (!el) return;
        el.className = '';
        el.id = 'cinema-header';
        if (!enabled) {
            el.textContent = '';
            el.style.display = 'none';
            body.classList.remove('cinema-header-active');
            return;
        }
        // Wrap in span so CSS can balance multi-line and stretch width
        const safe = (text || '').trim();
        el.innerHTML = safe ? `<span>${safe.replace(/</g, '&lt;')}</span>` : '';
        el.classList.add(`style-${style || 'classic'}`);
        el.style.display = 'flex';
        body.classList.add('cinema-header-active');
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

        // Use EXACT same structure as cinema-display.js createFooter()
        const styleClasses = ['cinema-footer-specs', style, `icon-${iconSet}`].join(' ');
        root.className = styleClasses;

        // Sample data (realistic, not always 4K/Atmos)
        const sampleMedia = {
            resolution: '1080p',
            audioCodec: 'Dolby Digital+',
            audioChannels: '5.1',
            aspectRatio: '16:9',
            hasHDR: false,
            hasDolbyVision: false,
        };

        // Resolution - match cinema-display.js structure EXACTLY
        if (showResolution && sampleMedia.resolution) {
            const item = document.createElement('div');
            item.className = 'cinema-spec-item';
            item.innerHTML = `<i class="fas fa-tv"></i><span>${sampleMedia.resolution}</span>`;
            root.appendChild(item);
        }

        // Audio - match cinema-display.js structure EXACTLY
        if (showAudio && sampleMedia.audioCodec) {
            const item = document.createElement('div');
            item.className = 'cinema-spec-item';
            const audioText = sampleMedia.audioChannels
                ? `${sampleMedia.audioCodec} ${sampleMedia.audioChannels}`
                : sampleMedia.audioCodec;
            item.innerHTML = `<i class="fas fa-volume-up"></i><span>${audioText}</span>`;
            root.appendChild(item);
        }

        // Aspect Ratio - match cinema-display.js structure EXACTLY
        if (showAspectRatio && sampleMedia.aspectRatio) {
            const item = document.createElement('div');
            item.className = 'cinema-spec-item';
            item.innerHTML = `<i class="fas fa-expand"></i><span>${sampleMedia.aspectRatio}</span>`;
            root.appendChild(item);
        }

        // Flags (HDR, Dolby Vision) - match cinema-display.js structure EXACTLY
        if (showFlags) {
            if (sampleMedia.hasHDR || sampleMedia.hasDolbyVision) {
                const item = document.createElement('div');
                item.className = 'cinema-spec-item';
                const flagText = sampleMedia.hasDolbyVision ? 'Dolby Vision' : 'HDR';
                item.innerHTML = `<i class="fas fa-sun"></i><span>${flagText}</span>`;
                root.appendChild(item);
            }
        }

        root.style.display = root.children.length > 0 ? 'flex' : 'none';
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
            const isCinemaMode = config && config.cinemaMode === true;

            // Hide unwanted elements in cinema mode (metadata, clearlogo, RT badge)
            hideCinemaUnwantedElements(isCinemaMode);

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
