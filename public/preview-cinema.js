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

    // Size the poster area with perfectly symmetric bars based on viewport and 2:3 poster ratio
    function updatePosterLayoutPreview() {
        try {
            const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
            const vh = Math.max(
                document.documentElement.clientHeight || 0,
                window.innerHeight || 0
            );
            const posterHeightByWidth = Math.round(vw * 1.5);
            const posterHeight = Math.min(vh, posterHeightByWidth);
            const bar = Math.max(0, Math.round((vh - posterHeight) / 2));
            document.documentElement.style.setProperty('--poster-top', bar + 'px');
            document.documentElement.style.setProperty('--poster-bottom', bar + 'px');
        } catch (e) {
            console.warn('preview: updatePosterLayoutPreview error', e);
        }
    }

    // Set #poster background to current media's poster (preview-only helper to avoid races)
    function syncPosterFromCurrentMedia() {
        try {
            const posterEl = document.getElementById('poster');
            const m = window.__posterramaCurrentMedia;
            if (!posterEl || !m) return;
            if (m.posterUrl) {
                posterEl.style.backgroundImage = `url('${m.posterUrl}')`;
            }
        } catch (_) {
            // no-op
        }
    }

    function setHeader(text, style, enabled) {
        const el = $('#cinema-header');
        const body = document.body;
        if (!el) return;
        el.className = 'cinema-header';
        el.id = 'cinema-header';
        if (!enabled) {
            el.textContent = '';
            el.style.display = 'none';
            body.classList.remove('cinema-header-active');
            updatePosterLayoutPreview();
            return;
        }
        // Wrap in span so CSS can balance multi-line and stretch width
        const safe = (text || '').trim();
        el.innerHTML = safe ? `<span>${safe.replace(/</g, '&lt;')}</span>` : '';
        el.classList.add(`style-${style || 'classic'}`);
        el.style.display = 'flex';
        body.classList.add('cinema-header-active');
        updatePosterLayoutPreview();
    }
    function setFooterMarquee(text, style) {
        const m = $('#cinema-footer-marquee');
        if (!m) return;
        const span = m.querySelector('span');
        span.textContent = text || '';
        m.className = 'cinema-footer-marquee';
        m.classList.add(`style-${style || 'classic'}`);
        m.style.display = text ? 'block' : 'none';
        updatePosterLayoutPreview();
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
        updatePosterLayoutPreview();
    }
    function setFooter(type, marqueeText, marqueeStyle, specs, enabled) {
        const marq = $('#cinema-footer-marquee');
        const spec = $('#cinema-footer-specs');
        const body = document.body;

        if (!enabled) {
            if (marq) marq.style.display = 'none';
            if (spec) spec.style.display = 'none';
            body.classList.remove('cinema-footer-active');
            updatePosterLayoutPreview();
            return;
        }

        // Add body class for footer spacing
        body.classList.add('cinema-footer-active');

        if (type === 'marquee') {
            setFooterMarquee(marqueeText, marqueeStyle);
            if (marq) marq.style.display = marqueeText ? 'block' : 'none';
            if (spec) spec.style.display = 'none';
        } else {
            setFooterSpecs(specs);
            if (marq) marq.style.display = 'none';
            if (spec) spec.style.display = 'flex';
        }
        updatePosterLayoutPreview();
    }
    function setAmbilight(enabled, strength) {
        const a = $('#cinema-ambilight');
        if (!a) return;
        // Ensure class for CSS targeting
        if (!a.classList.contains('cinema-ambilight')) a.classList.add('cinema-ambilight');
        a.style.opacity = enabled ? String(Math.max(0, Math.min(100, strength || 60)) / 100) : '0';
    }
    function applyCinemaOverlays(config) {
        try {
            const c = config && config.cinema ? config.cinema : {};
            const isCinemaMode = config && config.cinemaMode === true;

            // Hide unwanted elements in cinema mode (metadata, clearlogo, RT badge)
            hideCinemaUnwantedElements(isCinemaMode);

            // Reflect body class for preview-only CSS
            try {
                document.body.classList.toggle('cinema-mode', !!isCinemaMode);
                if (isCinemaMode) document.body.classList.remove('wallart-mode');
            } catch (_) {
                /* noop: preview-only path */
            }

            if (!isCinemaMode) {
                // Not in cinema preview: fully hide/clear all cinema overlays
                const h = $('#cinema-header');
                const fm = $('#cinema-footer-marquee');
                const fs = $('#cinema-footer-specs');
                const amb = $('#cinema-ambilight');
                document.body.classList.remove('cinema-header-active', 'cinema-footer-active');
                if (h) {
                    h.style.display = 'none';
                    h.textContent = '';
                    h.className = 'cinema-header';
                }
                if (fm) {
                    fm.style.display = 'none';
                    fm.className = 'cinema-footer-marquee';
                }
                if (fs) {
                    fs.style.display = 'none';
                    fs.className = 'cinema-footer-specs';
                    fs.innerHTML = '';
                }
                if (amb) {
                    if (!amb.classList.contains('cinema-ambilight'))
                        amb.classList.add('cinema-ambilight');
                    amb.style.opacity = '0';
                }
                updatePosterLayoutPreview();
                return; // Do not apply cinema config when not in cinema preview
            }

            // In cinema preview: apply overlays
            if (typeof window.appConfig !== 'object') window.appConfig = {};
            window.appConfig.cinemaMode = true;
            window.appConfig.cinemaOrientation = 'auto';
            if (!window.appConfig.wallartMode) window.appConfig.wallartMode = { enabled: false };

            setHeader(c.header?.text, c.header?.style, !!c.header?.enabled);
            setFooter(
                c.footer?.type || 'specs',
                c.footer?.marqueeText,
                c.footer?.marqueeStyle,
                c.footer?.specs,
                !!c.footer?.enabled
            );
            setAmbilight(c.ambilight?.enabled !== false, c.ambilight?.strength ?? 60);

            updatePosterLayoutPreview();
            syncPosterFromCurrentMedia();
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

    // Keep layout correct on window resize
    window.addEventListener('resize', updatePosterLayoutPreview);
    // Keep poster in sync with current media updates
    window.addEventListener('mediaUpdated', syncPosterFromCurrentMedia);

    // No debug controls exported

    // Do not override global applySettings in preview; rely on postMessage updates from admin
})();
