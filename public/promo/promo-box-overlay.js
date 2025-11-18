/**
 * Promo Box Overlay
 * Injects promotional content as an overlay on top of any display mode
 * when config.promoBoxEnabled is true (typically on port 4001 promo site)
 */

(function () {
    'use strict';

    // Only inject if we haven't already
    if (window.__promoBoxInjected) {
        return;
    }
    window.__promoBoxInjected = true;

    console.debug('[Promo Overlay] Initializing promo-box overlay');

    /**
     * Inject the promo-box HTML into the DOM
     */
    function injectPromoBox() {
        const promoHTML = `
            <main id="promo-box" class="promo-overlay">
                <header class="promo-logo">
                    <img
                        src="/logo.png"
                        alt="Posterrama Digital Movie Poster App Logo"
                        role="img"
                    />
                </header>
                <h1>Transform your screens into personal galleries</h1>
                <p>
                    This is <span class="promo-brand-name">posterrama</span>, a stunning self-hosted app that showcases dynamic posters from your movies, series, music, games<span class="movie-extensions">+ Art</span> collection. Perfect for digital signage, ambient displays, or elegant screensavers.
                </p>

                <!-- Hidden SEO content -->
                <div class="seo-content" style="position: absolute; left: -9999px; top: -9999px">
                    <h2>Features</h2>
                    <ul>
                        <li>Digital movie poster displays for home theaters</li>
                        <li>Cinema mode for portrait orientation screens</li>
                        <li>Beautiful screensavers from your media collection</li>
                        <li>Self-hosted media management</li>
                        <li>Plex media server integration</li>
                        <li>Multi-screen support for digital signage</li>
                        <li>Responsive design for all devices</li>
                        <li>Open source and free to use</li>
                    </ul>

                    <h2>Perfect for</h2>
                    <ul>
                        <li>Home theater enthusiasts</li>
                        <li>Media room displays</li>
                        <li>Digital signage projects</li>
                        <li>Plex server companions</li>
                        <li>Movie collection showcases</li>
                        <li>Personal cinema setups</li>
                    </ul>
                </div>

                <section class="promo-cta">
                    <a
                        href="https://github.com/Posterrama/posterrama"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="button-promo"
                        aria-label="Download Posterrama from GitHub"
                    >
                        <i class="fab fa-github"></i>
                        Get it on GitHub
                    </a>
                    
                    <!-- One-liner installation section -->
                    <div class="oneliner-install">
                        <p class="oneliner-text">Install instantly with one command:</p>
                        <div class="oneliner-command" onclick="window.__copyPromoCommand(this)">
                            <code>curl -fsSL https://raw.githubusercontent.com/Posterrama/posterrama/main/install.sh | bash</code>
                            <span class="copy-indicator">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                    <path d="m5 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2"></path>
                                </svg>
                            </span>
                        </div>
                    </div>
                </section>
            </main>
        `;

        // Inject into body
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = promoHTML.trim();
        const promoBox = tempDiv.firstChild;
        document.body.appendChild(promoBox);

        console.debug('[Promo Overlay] Promo-box HTML injected');

        // Show the promo box
        setTimeout(() => {
            promoBox.style.display = 'block';
            promoBox.style.opacity = '1';
            promoBox.style.visibility = 'visible';
            promoBox.classList.remove('is-hidden');

            // FORCE oneliner command styling (fallback if CSS doesn't load properly)
            const oneliners = promoBox.querySelectorAll('.oneliner-command');
            oneliners.forEach(el => {
                el.style.background = 'rgba(255, 255, 255, 0.1)';
                el.style.backdropFilter = 'blur(10px)';
                el.style.webkitBackdropFilter = 'blur(10px)';
                el.style.border = '1px solid rgba(255, 255, 255, 0.2)';
                el.style.borderRadius = '12px';
                el.style.padding = '16px 50px 16px 20px';
                el.style.boxShadow = '0 4px 30px rgba(0, 0, 0, 0.1)';

                // Make code text smaller and on one line
                const code = el.querySelector('code');
                if (code) {
                    code.style.fontWeight = '400';
                    code.style.fontSize = '0.85em';
                    code.style.whiteSpace = 'nowrap';
                    code.style.overflowX = 'auto';
                }
            });

            console.debug('[Promo Overlay] Promo-box made visible with forced styling');
        }, 100);

        // Mobile optimization
        if (window.innerWidth <= 1024) {
            promoBox.style.setProperty('width', 'calc(100vw - 40px)', 'important');
            promoBox.style.setProperty('max-width', 'none', 'important');
            promoBox.style.setProperty('padding', '30px 20px', 'important');
            promoBox.style.setProperty('min-height', 'auto', 'important');
            promoBox.style.setProperty('box-sizing', 'border-box', 'important');
            promoBox.style.setProperty('margin', '0', 'important');
            promoBox.style.setProperty('position', 'fixed', 'important');
            promoBox.style.setProperty('left', '50%', 'important');
            promoBox.style.setProperty('top', '50%', 'important');
            promoBox.style.setProperty('transform', 'translate(-50%, -50%)', 'important');
        }
    }

    /**
     * Copy command to clipboard
     */
    window.__copyPromoCommand = function (element) {
        const code = element.querySelector('code').textContent;
        navigator.clipboard
            .writeText(code)
            .then(() => {
                const indicator = element.querySelector('.copy-indicator');
                const originalSVG = indicator.innerHTML;
                indicator.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20,6 9,17 4,12"></polyline>
                </svg>`;
                setTimeout(() => {
                    indicator.innerHTML = originalSVG;
                }, 2000);
            })
            .catch(() => {
                // Fallback for older browsers
                const textArea = document.createElement('textarea');
                textArea.value = code;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);

                const indicator = element.querySelector('.copy-indicator');
                const originalSVG = indicator.innerHTML;
                indicator.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20,6 9,17 4,12"></polyline>
                </svg>`;
                setTimeout(() => {
                    indicator.innerHTML = originalSVG;
                }, 2000);
            });
    };

    /**
     * Initialize overlay when DOM is ready
     */
    function init() {
        // Mark body as promo site
        document.body.classList.add('promo-site');

        // Inject the promo box
        injectPromoBox();

        // Hide controls in cinema mode
        const controlsContainer = document.getElementById('controls-container');
        if (controlsContainer) {
            const checkCinemaMode = () => {
                if (document.body.classList.contains('cinema-mode')) {
                    controlsContainer.style.display = 'none';
                }
            };
            checkCinemaMode();
            // Re-check when mode changes
            const observer = new MutationObserver(checkCinemaMode);
            observer.observe(document.body, {
                attributes: true,
                attributeFilter: ['class'],
            });
        }

        // Poll for mode changes on promo site (since BroadcastChannel doesn't work cross-origin)
        let lastKnownMode = null;
        const checkModeChange = async () => {
            try {
                const resp = await fetch('/get-config?_t=' + Date.now(), { cache: 'no-cache' });
                if (!resp.ok) return;
                const cfg = await resp.json();

                const currentMode = cfg.cinemaMode
                    ? 'cinema'
                    : cfg.wallartMode?.enabled
                      ? 'wallart'
                      : 'screensaver';

                // Detect current page mode
                const pathname = window.location.pathname;
                const pageMode = pathname.includes('/cinema')
                    ? 'cinema'
                    : pathname.includes('/wallart')
                      ? 'wallart'
                      : 'screensaver';

                // If this is the first check, just store the mode
                if (lastKnownMode === null) {
                    lastKnownMode = currentMode;
                    return;
                }

                // If config mode changed and doesn't match page, navigate
                if (currentMode !== lastKnownMode && currentMode !== pageMode) {
                    console.log(
                        `[Promo] Mode changed from ${lastKnownMode} to ${currentMode}, navigating...`
                    );
                    lastKnownMode = currentMode;

                    // Use Core.navigateToMode if available, otherwise manual redirect
                    if (
                        window.PosterramaCore &&
                        typeof window.PosterramaCore.navigateToMode === 'function'
                    ) {
                        window.PosterramaCore.navigateToMode(currentMode);
                    } else {
                        const modeUrls = {
                            cinema: '/cinema.html',
                            wallart: '/wallart.html',
                            screensaver: '/screensaver.html',
                        };
                        window.location.href = modeUrls[currentMode] || '/';
                    }
                }

                lastKnownMode = currentMode;
            } catch (e) {
                console.warn('[Promo] Mode check failed:', e);
            }
        };

        // Check every 2 seconds for mode changes
        setInterval(checkModeChange, 2000);
        // Initial check after short delay to let config load
        setTimeout(checkModeChange, 500);

        console.debug('[Promo Overlay] Initialization complete');
    }

    // Run when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
