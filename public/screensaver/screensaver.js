// Screensaver module: extracted helpers from script.js for screensaver-specific behavior
(function initScreensaverModule() {
    try {
        // Define a single namespace on window to avoid globals
        const api = {
            // Helper: in screensaver mode, re-assert visibility of poster/metadata/info container
            ensureVisibility() {
                try {
                    const isScreensaver =
                        !window.appConfig?.cinemaMode && !window.appConfig?.wallartMode?.enabled;
                    if (!isScreensaver) return;
                    const posterVisible = window.appConfig?.showPoster !== false;
                    const metaVisible = window.appConfig?.showMetadata !== false;

                    const infoContainer = document.getElementById('info-container');
                    const posterWrapper = document.getElementById('poster-wrapper');
                    const textWrapper = document.getElementById('text-wrapper');

                    // Toggle poster and metadata wrappers
                    if (posterWrapper) posterWrapper.classList.toggle('is-hidden', !posterVisible);
                    if (textWrapper) textWrapper.classList.toggle('is-hidden', !metaVisible);

                    // If any is visible, ensure the container is shown
                    if (posterVisible || metaVisible) {
                        if (infoContainer) {
                            infoContainer.classList.add('visible');
                            // Also guard against inline display:none from previous modes
                            if (infoContainer.style.display === 'none') {
                                infoContainer.style.display = 'flex';
                            }
                        }
                    } else if (infoContainer) {
                        // Hide the container when nothing should be shown
                        infoContainer.classList.remove('visible');
                    }
                } catch (_) {
                    /* noop: visibility update is best-effort */
                }
            },

            // Helper: detect if a Ken Burns animation is currently active on either layer
            isKenBurnsActive() {
                try {
                    // In admin live preview, pretend no Ken Burns is active
                    if (window.IS_PREVIEW) return false;
                    const la = document.getElementById('layer-a');
                    const lb = document.getElementById('layer-b');
                    if (!la || !lb) return false;
                    return (
                        (la.hasAttribute('data-ken-burns') &&
                            la.getAttribute('data-ken-burns') !== 'false') ||
                        (lb.hasAttribute('data-ken-burns') &&
                            lb.getAttribute('data-ken-burns') !== 'false')
                    );
                } catch (_) {
                    return false; // Return false if an error occurs
                }
            },

            // Helper: force-initialize background layers when returning to screensaver mode
            // NOTE: If Ken Burns is active, defer reinit to avoid visible transform snaps.
            reinitBackground() {
                try {
                    const isScreensaver =
                        !window.appConfig?.cinemaMode && !window.appConfig?.wallartMode?.enabled;
                    if (!isScreensaver) return;

                    // If Ken Burns is currently active on any layer, postpone reinit slightly.
                    if (api.isKenBurnsActive()) {
                        // Debounced retry to avoid stacking timers
                        if (window._reinitRetryTimer) {
                            clearTimeout(window._reinitRetryTimer);
                            window._reinitRetryTimer = null;
                        }
                        window._reinitRetryTimer = setTimeout(() => {
                            window._reinitRetryTimer = null;
                            try {
                                if (
                                    !api.isKenBurnsActive() &&
                                    !window.appConfig?.cinemaMode &&
                                    !window.appConfig?.wallartMode?.enabled
                                ) {
                                    api.reinitBackground();
                                }
                            } catch (_) {
                                /* noop: best-effort retry */
                            }
                        }, 650);
                        return; // Don't reset transforms mid-KB
                    }

                    const la = document.getElementById('layer-a');
                    const lb = document.getElementById('layer-b');
                    if (!la || !lb) return;

                    // Reset styles (safe now because no active Ken Burns)
                    [la, lb].forEach(el => {
                        el.style.animation = 'none';
                        el.style.transition = 'none';
                        el.style.transform = 'none';
                    });

                    // Choose a media item
                    let mediaItem = null;
                    try {
                        if (Array.isArray(window.mediaQueue) && window.mediaQueue.length > 0) {
                            const idx =
                                typeof window.currentIndex === 'number' && window.currentIndex >= 0
                                    ? window.currentIndex
                                    : 0;
                            mediaItem = window.mediaQueue[idx] || window.mediaQueue[0];
                        }
                    } catch (_) {}

                    if (mediaItem && mediaItem.backgroundUrl) {
                        const bg = mediaItem.backgroundUrl;
                        if (bg && bg !== 'null' && bg !== 'undefined') {
                            la.style.backgroundImage = `url('${bg}')`;
                            // Preload lb with the same image as a safe fallback; it will be replaced on next cycle
                            lb.style.backgroundImage = `url('${bg}')`;
                        } else {
                            la.style.backgroundImage = '';
                            lb.style.backgroundImage = '';
                        }
                    }

                    // Make sure the visible layer shows immediately
                    la.style.transition = 'none';
                    lb.style.transition = 'none';
                    la.style.opacity = '1';
                    lb.style.opacity = '0';

                    // Reset references to a known state
                    window.activeLayer = la;
                    window.inactiveLayer = lb;
                } catch (_) {
                    /* noop: reinit is best-effort */ void 0;
                }
            },
        };

        // Attach to window; only on the screensaver page we actually use it, on others wrappers will no-op
        window.PosterramaScreensaver = api;

        if (
            document.body &&
            document.body.dataset.mode === 'screensaver' &&
            window.POSTERRAMA_DEBUG
        ) {
            console.log('[Screensaver] module loaded');
        }
    } catch (e) {
        if (window && window.console) console.debug('[Screensaver] module init error');
    }
})();
