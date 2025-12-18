'use strict';
/**
 * Cinema Display Mode
 * Author: Posterrama Team
 * Last Modified: 2025-12-01
 * License: GPL-3.0-or-later
 *
 * This module handles cinema-specific display functionality:
 * - Portrait/landscape orientation management
 * - Header/footer overlays with marquee and specs
 * - Ambilight effects
 * - Cinema-specific poster display and transitions
 */

(function () {
    // Reset pause state on page load (fresh start = not paused)
    // This ensures admin UI is updated correctly when display refreshes
    try {
        window.__posterramaPaused = false;
    } catch (_) {
        /* ignore */
    }

    // (debug logging available via window.logger)

    function isPreviewMode() {
        try {
            const params = new URLSearchParams(window.location.search || '');
            return (
                params.get('preview') === '1' ||
                window.self !== window.top ||
                window.Core?.isPreviewMode?.() ||
                window.PosterramaCore?.isPreviewMode?.()
            );
        } catch (_) {
            return false;
        }
    }

    const IS_PREVIEW_MODE = isPreviewMode();
    let cinemaModeInitialized = false;

    // Track effective background color for ton-sur-ton calculation
    let effectiveBgColor = '#000000';

    // Track if cinema mode has completed initialization (prevents duplicate poster displays)
    let cinemaInitialized = false;

    // ===== Cinema Mode Configuration =====
    const cinemaConfig = {
        orientation: 'auto', // auto, portrait, portrait-flipped
        rotationIntervalMinutes: 5, // 0 = disabled, supports decimals (0.5 = 30 seconds)
        header: {
            enabled: true,
            text: 'Now Playing',
            typography: {
                fontFamily: 'cinematic',
                fontSize: 100,
                color: '#ffffff',
                shadow: 'subtle',
                animation: 'none',
            },
        },
        footer: {
            enabled: true,
            type: 'metadata', // marquee, metadata, tagline
            marqueeText: 'Feature Presentation',
            typography: {
                fontFamily: 'system',
                fontSize: 100,
                color: '#cccccc',
                shadow: 'none',
            },
        },
        ambilight: {
            enabled: true,
            strength: 60, // 0-100
        },
        // === Poster presentation ===
        poster: {
            style: 'floating', // fullBleed, framed, floating, perspective
            transitionDuration: 1.5, // seconds
            frameColor: '#333333',
            frameColorMode: 'custom', // custom, tonSurTonLight, tonSurTonDark
            frameWidth: 8, // pixels
            cinematicTransitions: {
                enabledTransitions: [
                    'fade',
                    'slideUp',
                    'cinematic',
                    'lightFlare',
                    'shatter',
                    'unfold',
                    'swing',
                    'ripple',
                    'curtainReveal',
                    'filmGate',
                    'projectorFlicker',
                    'parallaxFloat',
                    'dollyIn',
                    'splitFlap',
                    'lensIris',
                ],
                selectionMode: 'random', // random, sequential, smart, single
                singleTransition: 'fade',
            },
        },
        // === NEW: Background settings ===
        background: {
            mode: 'solid', // solid, blurred, gradient, ambient
            solidColor: '#000000',
            blurAmount: 20, // pixels
            vignette: 'subtle', // none, subtle, dramatic
        },
        // === NEW: Metadata display ===
        metadata: {
            layout: 'comfortable', // compact, comfortable, spacious
            showYear: true,
            showRuntime: true,
            showRating: true,
            showCertification: false,
            showGenre: false,
            showDirector: false,
            showStudioLogo: false,
            position: 'bottom', // bottom, side, overlay
            specs: {
                showResolution: true,
                showAudio: true,
                showHDR: true,
                showAspectRatio: false,
                style: 'badges', // subtle, badges, icons
                iconSet: 'tabler', // tabler, mediaflags
            },
        },
        // === NEW: Promotional features ===
        promotional: {
            showRating: false,
            showWatchProviders: false,
            showAwardsBadge: false,
            trailer: {
                enabled: false,
                muted: true,
                loop: true,
            },
            qrCode: {
                enabled: false,
                url: '',
                position: 'bottomRight',
                size: 100,
            },
        },
        // === NEW: Global effects ===
        globalEffects: {
            colorFilter: 'none', // none, sepia, cool, warm, tint
            tintColor: '#ff6b00', // Custom tint color when colorFilter='tint'
            contrast: 100, // 50-150
            brightness: 100, // 50-150
        },
    };

    // ===== State =====
    let currentMedia = null; // Track current media for live updates
    let isPinned = false; // Track if current poster is pinned
    let pinnedMediaId = null; // Store pinned media ID
    let pinnedByConfig = false; // True when pinned via settings override (not user controls)
    let rotationTimer = null; // Timer for automatic poster rotation
    let mediaQueue = []; // Queue of media items for rotation
    let nowPlayingTimer = null; // Timer for Now Playing session polling
    let lastSessionId = null; // Track last active session to detect changes
    let nowPlayingActive = false; // Track if currently showing Now Playing poster
    let sequentialTransitionIndex = 0; // Index for sequential transition mode
    let isUpdateInProgress = false; // Lock to prevent concurrent updates
    let pendingUpdate = null; // Store pending update if one is in progress
    let lastUpdateTime = 0; // Track last update timestamp for debugging
    let updateCounter = 0; // Counter for tracking update sequence

    // ===== DOM Element References =====
    let headerEl = null;
    let footerEl = null;
    let ambilightEl = null;

    // Dynamically size poster area with perfectly symmetric top/bottom bars
    function updatePosterLayout() {
        try {
            const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
            const vh = Math.max(
                document.documentElement.clientHeight || 0,
                window.innerHeight || 0
            );
            // Poster native aspect ratio is 2:3 (width:height)
            const posterHeightByWidth = Math.round(vw * 1.5);
            const posterHeight = Math.min(vh, posterHeightByWidth);
            const posterWidth = Math.round(posterHeight / 1.5); // width = height / 1.5
            const bar = Math.max(0, Math.round((vh - posterHeight) / 2));
            document.documentElement.style.setProperty('--poster-top', bar + 'px');
            document.documentElement.style.setProperty('--poster-bottom', bar + 'px');
            document.documentElement.style.setProperty('--poster-width', posterWidth + 'px');
            document.documentElement.style.setProperty('--poster-height', posterHeight + 'px');
        } catch (e) {
            if (window.logger && window.logger.warn) {
                window.logger.warn('[Cinema Display] updatePosterLayout error', {
                    message: e?.message,
                });
            }
        }
    }

    // ===== Utility Functions =====
    function log(message, data) {
        if (window.logger && window.logger.info) {
            window.logger.info(`[Cinema Display] ${message}`, data);
        }
    }

    function debug(message, data) {
        if (window.logger && window.logger.debug) {
            window.logger.debug(`[Cinema Display] ${message}`, data);
        }
    }

    function warn(message, data) {
        if (window.logger && window.logger.warn) {
            window.logger.warn(`[Cinema Display] ${message}`, data);
        } else if (window.logger && window.logger.info) {
            window.logger.info(`[Cinema Display] WARN: ${message}`, data);
        }
    }

    function restartCssClassAnimation(el, className) {
        if (!el || !className) return;
        if (!el.classList.contains(className)) return;
        el.classList.remove(className);
        // Force reflow to restart the CSS animation
        void el.offsetWidth;
        el.classList.add(className);
    }

    // Debug overlay removed for production

    function error(message, data) {
        if (window.logger && window.logger.error) {
            window.logger.error(`[Cinema] ${message}`, data);
        }
    }

    // ===== Cinema Orientation Management =====
    function applyCinemaOrientation(orientation) {
        const body = document.body;

        // Remove existing orientation classes
        body.classList.remove(
            'cinema-auto',
            'cinema-portrait',
            'cinema-landscape',
            'cinema-portrait-flipped',
            'cinema-landscape-flipped'
        );

        // Handle auto orientation: use sensor if available, otherwise aspect ratio
        let resolvedOrientation = orientation;
        if (orientation === 'auto') {
            // Try screen orientation API first
            if (window.screen?.orientation?.type) {
                const type = window.screen.orientation.type;
                if (type.includes('portrait')) {
                    resolvedOrientation = 'portrait';
                } else {
                    resolvedOrientation = 'landscape';
                }
            } else {
                // Fallback: use aspect ratio (width > height = landscape)
                resolvedOrientation =
                    window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';
            }
            log(`Auto-detected orientation: ${resolvedOrientation}`);
        }

        // Add new orientation class
        body.classList.add(`cinema-${resolvedOrientation}`);

        log(`Applied cinema orientation: ${orientation} (resolved: ${resolvedOrientation})`);
    }

    // ===== Context-Aware Header Text Selection =====
    /**
     * Determines the appropriate header text based on current context.
     * Priority order is configurable via ctx.priorityOrder array.
     * Default priority (highest to lowest):
     * 1. Now Playing (if currently playing media)
     * 2. 4K Ultra HD (if media is 4K)
     * 3. Certified Fresh (if RT score > 90%)
     * 4. Coming Soon (if unreleased)
     * 5. New Arrival (if added < 7 days ago)
     * 6. Late Night (23:00-06:00)
     * 7. Weekend (Saturday/Sunday daytime)
     * 8. Default
     */
    function getContextAwareHeaderText() {
        const ctx = cinemaConfig.header?.contextHeaders;

        // If context headers not enabled, use static header text
        if (!ctx?.enabled) {
            return cinemaConfig.header?.text || 'Now Playing';
        }

        const defaultText = ctx.default || cinemaConfig.header?.text || 'Now Playing';
        const media = currentMedia;
        const now = new Date();
        const hour = now.getHours();
        const dayOfWeek = now.getDay(); // 0 = Sunday, 6 = Saturday

        // Debug info (kept behind logger.debug)
        debug('Context header detection', {
            now: now.toISOString(),
            hour,
            dayOfWeek,
            nowPlayingActive,
            priorityOrder: ctx.priorityOrder || 'default',
            contextConfig: ctx,
            mediaPresent: !!media,
        });

        // Helper to get context text or inherit from default
        const getText = key => {
            const val = ctx[key];
            return val === null || val === undefined ? null : val;
        };

        // Context detection functions
        const contextDetectors = {
            nowPlaying: () => {
                if (nowPlayingActive && getText('nowPlaying')) {
                    log('Context header: Now Playing');
                    return getText('nowPlaying');
                }
                return null;
            },
            ultra4k: () => {
                if (media && getText('ultra4k')) {
                    const resolution =
                        media.videoResolution ||
                        media.resolution ||
                        media.qualityLabel ||
                        media.quality ||
                        '';
                    const is4K =
                        resolution === '4k' ||
                        resolution === '4K' ||
                        resolution === '2160' ||
                        resolution === '2160p' ||
                        (media.width && media.width >= 3840) ||
                        media.Media?.[0]?.videoResolution === '4k';
                    if (is4K) {
                        log('Context header: 4K Ultra HD');
                        return getText('ultra4k');
                    }
                }
                return null;
            },
            certifiedFresh: () => {
                if (media && getText('certifiedFresh')) {
                    const rtScore =
                        media.rottenTomatoesScore ||
                        media.audienceRating ||
                        media.rottenTomatoes?.score ||
                        0;
                    if (rtScore >= 90) {
                        log('Context header: Certified Fresh', { rtScore });
                        return getText('certifiedFresh');
                    }
                }
                return null;
            },
            comingSoon: () => {
                if (media && getText('comingSoon')) {
                    const releaseDate = media.releaseDate || media.originallyAvailableAt;
                    if (releaseDate) {
                        const release = new Date(releaseDate);
                        if (release > now) {
                            log('Context header: Coming Soon', { releaseDate });
                            return getText('comingSoon');
                        }
                    }
                }
                return null;
            },
            newArrival: () => {
                if (media && getText('newArrival')) {
                    const addedAt = media.addedAt || media.addedAtMs || media.dateAdded;
                    if (addedAt) {
                        // Handle both timestamps (ms) and ISO strings
                        const added =
                            typeof addedAt === 'number' ? new Date(addedAt) : new Date(addedAt);
                        const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
                        if (added > fourteenDaysAgo) {
                            log('Context header: New Arrival', { addedAt });
                            return getText('newArrival');
                        }
                    }
                }
                return null;
            },
            lateNight: () => {
                if (getText('lateNight') && (hour >= 23 || hour < 6)) {
                    log('Context header: Late Night', { hour });
                    return getText('lateNight');
                }
                return null;
            },
            weekend: () => {
                if (
                    getText('weekend') &&
                    (dayOfWeek === 0 || dayOfWeek === 6) &&
                    hour >= 6 &&
                    hour < 23
                ) {
                    log('Context header: Weekend', { dayOfWeek });
                    return getText('weekend');
                }
                return null;
            },
        };

        // Default priority order
        const defaultPriorityOrder = [
            'nowPlaying',
            'ultra4k',
            'certifiedFresh',
            'comingSoon',
            'newArrival',
            'lateNight',
            'weekend',
        ];

        // Use configured priority order or fallback to default
        const priorityOrder =
            Array.isArray(ctx.priorityOrder) &&
            ctx.priorityOrder.length === defaultPriorityOrder.length
                ? ctx.priorityOrder
                : defaultPriorityOrder;

        // Check contexts in priority order
        for (const key of priorityOrder) {
            const detector = contextDetectors[key];
            if (detector) {
                const result = detector();
                if (result) return result;
            }
        }

        // Fallback to default
        log('Context header: Default');
        return defaultText;
    }

    // ===== Cinema Header =====
    function createHeader(options = {}) {
        const { restartEntranceAnimation = false } = options;
        if (!cinemaConfig.header.enabled) {
            if (headerEl) {
                headerEl.remove();
                headerEl = null;
            }
            document.body.classList.remove('cinema-header-active');
            return;
        }

        const typo = cinemaConfig.header.typography || {};

        // Create or update header element
        if (!headerEl) {
            headerEl = document.createElement('div');
            headerEl.className = 'cinema-header';
            // Hide initially to prevent flash of unstyled content
            headerEl.style.visibility = 'hidden';
            document.body.appendChild(headerEl);
        }

        // Apply header typography classes
        const fontClass = `font-${typo.fontFamily || 'cinematic'}`;
        const shadowClass = `shadow-${typo.shadow || 'subtle'}`;
        // Animation effects that need anim- prefix (pulse, marquee are in textEffect now)
        const animationEffects = ['pulse', 'marquee'];
        const isAnimationEffect = animationEffects.includes(typo.textEffect);
        const animClass = isAnimationEffect ? `anim-${typo.textEffect}` : '';

        // Text Reveal entrance animations don't work with decorations
        const textRevealEntrances = ['typewriter', 'fade-words', 'letter-spread'];
        const isTextRevealEntrance = textRevealEntrances.includes(typo.entranceAnimation);

        // Decoration only applies when no animation effect and no text reveal entrance is selected
        const decorationClass =
            !isAnimationEffect &&
            !isTextRevealEntrance &&
            typo.decoration &&
            typo.decoration !== 'none'
                ? `decoration-${typo.decoration}`
                : '';
        // Text effect class (gradient, metallic, outline, neon, etc.) - Issue #126
        // Skip anim- prefix effects as they use different class naming
        const textEffectClass =
            typo.textEffect && typo.textEffect !== 'none' && !isAnimationEffect
                ? `text-effect-${typo.textEffect}`
                : '';
        // Entrance animation class (typewriter, slide-in, zoom, etc.) - Issue #126
        const entranceClass =
            typo.entranceAnimation && typo.entranceAnimation !== 'none'
                ? `entrance-${typo.entranceAnimation}`
                : '';
        headerEl.className =
            `cinema-header ${fontClass} ${shadowClass} ${animClass} ${decorationClass} ${textEffectClass} ${entranceClass}`
                .trim()
                .replace(/\\s+/g, ' ');

        if (restartEntranceAnimation && entranceClass) {
            restartCssClassAnimation(headerEl, entranceClass);
        }

        // Apply inline styles for size and color
        headerEl.style.setProperty('--header-font-size', `${(typo.fontSize || 100) / 100}`);

        // Calculate color: use ton-sur-ton if enabled, otherwise use configured color
        let headerColor = typo.color || '#ffffff';
        if (typo.tonSurTon && effectiveBgColor) {
            const intensity = typo.tonSurTonIntensity || 15;
            headerColor = calculateTonSurTon(effectiveBgColor, intensity);
        }
        headerEl.style.setProperty('--header-color', headerColor);
        headerEl.style.color = headerColor; // Direct color application for reliability
        headerEl.style.backgroundColor = ''; // Reset any previous background

        // Set header text - use context-aware text if enabled
        const headerText = getContextAwareHeaderText();

        // For typewriter entrance animation - type character by character
        if (typo.entranceAnimation === 'typewriter') {
            const inner = document.createElement('span');
            // Add text effect class to inner span so gradients etc work on the text
            inner.className = `typewriter-inner ${textEffectClass}`.trim();
            // Force inline styles to ensure visibility
            inner.style.cssText = 'display: inline-block; white-space: nowrap; position: relative;';
            inner.textContent = ''; // Start empty
            headerEl.innerHTML = '';
            headerEl.appendChild(inner);

            const chars = headerText.split('');
            let currentIndex = 0;
            const msPerChar = 70; // Speed per character

            // Type one character at a time
            const typeInterval = setInterval(() => {
                if (currentIndex < chars.length) {
                    inner.textContent += chars[currentIndex];
                    currentIndex++;
                } else {
                    clearInterval(typeInterval);
                    // Hide cursor after typing is done
                    setTimeout(() => {
                        inner.classList.add('typing-done');
                    }, 200);
                }
            }, msPerChar);
        }
        // For fade-words entrance animation, wrap each word in a span with staggered delay
        else if (typo.entranceAnimation === 'fade-words') {
            const words = headerText.split(' ').filter(w => w.length > 0);
            // Add text effect class to each word span so gradients etc work
            const wordClass = textEffectClass ? `word ${textEffectClass}` : 'word';
            const html = words
                .map(
                    (word, i) =>
                        `<span class="${wordClass}" style="display: inline-block; opacity: 0; animation: fadeInWord 0.5s ease forwards; animation-delay: ${0.2 + i * 0.15}s">${word}</span>`
                )
                .join(' ');
            headerEl.innerHTML = html;
        } else {
            headerEl.textContent = headerText;
        }

        // Show header now that styling is complete (was hidden to prevent FOUC)
        headerEl.style.visibility = 'visible';

        // Add body class to adjust info-container padding
        document.body.classList.add('cinema-header-active');

        // Update poster layout after header changes
        updatePosterLayout();

        log('Cinema header created/updated', {
            text: headerText,
            contextEnabled: cinemaConfig.header?.contextHeaders?.enabled,
            typography: typo,
        });
    }

    // ===== Cinema Footer =====
    function createFooter(currentMedia) {
        if (!cinemaConfig.footer.enabled) {
            if (footerEl) {
                footerEl.remove();
                footerEl = null;
            }
            document.body.classList.remove('cinema-footer-active');
            updatePosterLayout();
            return;
        }

        const typo = cinemaConfig.footer.typography || {};

        // Add body class to adjust spacing
        document.body.classList.add('cinema-footer-active');
        // Update poster layout after footer changes
        updatePosterLayout();

        // Create or update footer element
        if (!footerEl) {
            footerEl = document.createElement('div');
            footerEl.className = 'cinema-footer';
            document.body.appendChild(footerEl);
        }

        // Apply footer typography
        const fontClass = `font-${typo.fontFamily || 'system'}`;
        const shadowClass = `shadow-${typo.shadow || 'none'}`;
        const layout = cinemaConfig.metadata?.layout || 'comfortable';
        footerEl.className = `cinema-footer ${fontClass} ${shadowClass} layout-${layout}`;
        footerEl.style.setProperty('--footer-font-size', `${(typo.fontSize || 100) / 100}`);

        // Calculate color: use ton-sur-ton if enabled, otherwise use configured color
        let footerColor = typo.color || '#cccccc';
        if (typo.tonSurTon && effectiveBgColor) {
            const intensity = typo.tonSurTonIntensity || 45;
            footerColor = calculateTonSurTon(effectiveBgColor, intensity);
        }
        footerEl.style.setProperty('--footer-color', footerColor);
        footerEl.style.color = footerColor; // Direct color application for reliability

        // Clear existing content
        footerEl.innerHTML = '';

        // Helper to calculate marquee duration and start animation.
        // Requirement: appears at 5% from the right edge, disappears at 5% from the left edge.
        // Target speed: ~60 pixels/sec for consistent reading speed.
        const startMarquee = (textEl, containerEl = null) => {
            requestAnimationFrame(() => {
                const container = containerEl || textEl.parentElement;
                if (!container) return;

                const textWidth = textEl.scrollWidth;
                const containerWidth = container.clientWidth;

                // Start: left edge at 95% of container width (5% inset from right)
                const startX = containerWidth * 0.95;
                // End: right edge at 5% of container width (5% inset from left)
                const endX = containerWidth * 0.05 - textWidth;

                textEl.style.setProperty('--marquee-start-x', `${startX}px`);
                textEl.style.setProperty('--marquee-end-x', `${endX}px`);

                const totalDistance = Math.abs(startX - endX);
                const duration = Math.max(10, Math.min(40, totalDistance / 60));
                textEl.style.animationDuration = `${duration}s`;

                // Reset animation to start fresh
                textEl.classList.remove('running');
                void textEl.offsetWidth;
                textEl.classList.add('running');
            });
        };

        if (cinemaConfig.footer.type === 'marquee') {
            // Marquee footer
            const marqueeDiv = document.createElement('div');
            marqueeDiv.className = 'cinema-footer-marquee';

            const marqueeText = document.createElement('div');
            marqueeText.className = 'cinema-footer-marquee-content';
            marqueeText.textContent = cinemaConfig.footer.marqueeText || 'Feature Presentation';

            marqueeDiv.appendChild(marqueeText);
            footerEl.appendChild(marqueeDiv);

            // Calculate duration and start animation
            startMarquee(marqueeText, marqueeDiv);

            log('Cinema footer marquee created', {
                text: cinemaConfig.footer.marqueeText,
                typography: typo,
            });
        } else if (cinemaConfig.footer.type === 'metadata' && currentMedia) {
            // Metadata footer - show Movie Info + Technical Specs
            const meta = cinemaConfig.metadata || {};
            const specs = meta.specs || {};

            // ===== Movie Info Section =====
            const movieInfoDiv = document.createElement('div');
            movieInfoDiv.className = `cinema-footer-movie-info layout-${layout}`;
            let hasMovieInfo = false;

            // Movie details row (year, runtime, rating, certification)
            const detailsRow = document.createElement('div');
            detailsRow.className = 'cinema-movie-details';

            // Year
            if (meta.showYear !== false && currentMedia.year) {
                const yearEl = document.createElement('span');
                yearEl.className = 'cinema-detail-item year';
                yearEl.textContent = currentMedia.year;
                detailsRow.appendChild(yearEl);
            }

            // Runtime
            if (meta.showRuntime !== false && currentMedia.runtime) {
                const runtimeEl = document.createElement('span');
                runtimeEl.className = 'cinema-detail-item runtime';
                // Format runtime (minutes to hours:minutes)
                const mins = parseInt(currentMedia.runtime, 10);
                const formatted =
                    mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
                runtimeEl.textContent = formatted;
                detailsRow.appendChild(runtimeEl);
            }

            // Rating (IMDB/user rating, not RT promotional badge)
            if (meta.showRating !== false && currentMedia.rating) {
                const ratingEl = document.createElement('span');
                ratingEl.className = 'cinema-detail-item rating';
                ratingEl.innerHTML = `<i class="fas fa-star"></i> ${currentMedia.rating}`;
                detailsRow.appendChild(ratingEl);
            }

            // Certification (content rating like PG-13)
            if (meta.showCertification && currentMedia.contentRating) {
                const certEl = document.createElement('span');
                certEl.className = 'cinema-detail-item certification';
                certEl.textContent = currentMedia.contentRating;
                detailsRow.appendChild(certEl);
            }

            if (detailsRow.children.length > 0) {
                movieInfoDiv.appendChild(detailsRow);
                hasMovieInfo = true;
            }

            // Genre
            if (meta.showGenre && currentMedia.genres && currentMedia.genres.length > 0) {
                const genreEl = document.createElement('div');
                genreEl.className = 'cinema-movie-genres';
                const genreText = Array.isArray(currentMedia.genres)
                    ? currentMedia.genres.slice(0, 3).join(' • ')
                    : currentMedia.genres;
                genreEl.textContent = genreText;
                movieInfoDiv.appendChild(genreEl);
                hasMovieInfo = true;
            }

            // Director
            if (meta.showDirector && currentMedia.director) {
                const dirEl = document.createElement('div');
                dirEl.className = 'cinema-movie-director';
                const dirName =
                    typeof currentMedia.director === 'object'
                        ? currentMedia.director.name
                        : currentMedia.director;
                dirEl.innerHTML = `<span class="label">Director:</span> ${dirName}`;
                movieInfoDiv.appendChild(dirEl);
                hasMovieInfo = true;
            }

            // Studio
            if (meta.showStudioLogo && currentMedia.studio) {
                const studioEl = document.createElement('div');
                studioEl.className = 'cinema-movie-studio';
                studioEl.innerHTML = `<span class="label">Studio:</span> ${currentMedia.studio}`;
                movieInfoDiv.appendChild(studioEl);
                hasMovieInfo = true;
            }

            if (hasMovieInfo) {
                footerEl.appendChild(movieInfoDiv);
            }

            // ===== Technical Specs Section =====
            const specsDiv = document.createElement('div');
            specsDiv.className = `cinema-footer-specs ${specs.style || 'icons-text'} icon-${specs.iconSet || 'tabler'} layout-${layout}`;

            const specsStyle = specs.style || 'icons-text';
            const iconSet = specs.iconSet || 'tabler';
            const isIconsOnly = specsStyle === 'icons-only';

            // Icon helper function - returns specific or generic icons based on style
            const getIcon = (type, value) => {
                // For icons-only mode, we need specific icons that represent the value
                if (isIconsOnly && iconSet === 'material') {
                    // Resolution-specific icons
                    if (type === 'resolution' && value) {
                        const resLower = value.toLowerCase();
                        if (
                            resLower.includes('4k') ||
                            resLower.includes('2160') ||
                            resLower.includes('uhd')
                        ) {
                            return '<span class="material-symbols-rounded">4k</span>';
                        } else if (
                            resLower.includes('1080') ||
                            resLower.includes('fhd') ||
                            resLower.includes('full hd')
                        ) {
                            return '<span class="material-symbols-rounded">full_hd</span>';
                        } else if (resLower.includes('720') || resLower.includes('hd')) {
                            return '<span class="material-symbols-rounded">hd</span>';
                        }
                        return '<span class="material-symbols-rounded">high_quality</span>';
                    }
                    // Audio-specific icons
                    if (type === 'audio' && value) {
                        const audioLower = value.toLowerCase();
                        if (audioLower.includes('atmos')) {
                            return '<span class="material-symbols-rounded">spatial_audio</span>';
                        } else if (audioLower.includes('dts:x') || audioLower.includes('dtsx')) {
                            return '<span class="material-symbols-rounded">spatial_audio_off</span>';
                        } else if (audioLower.includes('dts-hd') || audioLower.includes('dts hd')) {
                            return '<span class="material-symbols-rounded">equalizer</span>';
                        } else if (audioLower.includes('dts')) {
                            return '<span class="material-symbols-rounded">equalizer</span>';
                        } else if (
                            audioLower.includes('truehd') ||
                            audioLower.includes('true hd')
                        ) {
                            return '<span class="material-symbols-rounded">surround_sound</span>';
                        } else if (
                            audioLower.includes('dd+') ||
                            audioLower.includes('ddplus') ||
                            audioLower.includes('eac3')
                        ) {
                            return '<span class="material-symbols-rounded">surround_sound</span>';
                        } else if (
                            audioLower.includes('dolby') ||
                            audioLower.includes('ac3') ||
                            audioLower.includes('dd')
                        ) {
                            return '<span class="material-symbols-rounded">surround_sound</span>';
                        } else if (audioLower.includes('pcm')) {
                            return '<span class="material-symbols-rounded">hearing</span>';
                        } else if (audioLower.includes('stereo') || audioLower.includes('2.0')) {
                            return '<span class="material-symbols-rounded">speaker</span>';
                        } else if (audioLower.includes('mono') || audioLower.includes('1.0')) {
                            return '<span class="material-symbols-rounded">hearing</span>';
                        } else if (
                            audioLower.includes('aac') ||
                            audioLower.includes('flac') ||
                            audioLower.includes('mp3')
                        ) {
                            return '<span class="material-symbols-rounded">music_note</span>';
                        }
                        return '<span class="material-symbols-rounded">surround_sound</span>';
                    }
                    // HDR/Dolby Vision icons
                    if (type === 'hdr') {
                        return '<span class="material-symbols-rounded">hdr_on</span>';
                    }
                    if (type === 'hdr10') {
                        return '<span class="material-symbols-rounded">hdr_on</span>';
                    }
                    if (type === 'hdr10plus') {
                        return '<span class="material-symbols-rounded">hdr_auto</span>';
                    }
                    if (type === 'dolbyVision') {
                        return '<span class="material-symbols-rounded">hdr_auto</span>';
                    }
                    if (type === 'hlg') {
                        return '<span class="material-symbols-rounded">hdr_auto</span>';
                    }
                    if (type === 'aspectRatio') {
                        return '<span class="material-symbols-rounded">aspect_ratio</span>';
                    }
                }

                // For icons-only with Tabler, use similar logic
                if (isIconsOnly && iconSet === 'tabler') {
                    if (type === 'resolution' && value) {
                        const resLower = value.toLowerCase();
                        if (resLower.includes('4k') || resLower.includes('2160')) {
                            return '<i class="ti ti-badge-4k"></i>';
                        } else if (resLower.includes('1080')) {
                            return '<i class="ti ti-badge-hd"></i>';
                        }
                        return '<i class="ti ti-badge-sd"></i>';
                    }
                    if (type === 'audio' && value) {
                        const audioLower = value.toLowerCase();
                        if (
                            audioLower.includes('atmos') ||
                            audioLower.includes('7.1') ||
                            audioLower.includes('5.1')
                        ) {
                            return '<i class="ti ti-volume"></i>';
                        }
                        return '<i class="ti ti-volume-2"></i>';
                    }
                }

                // Generic icons for icons-text mode or fallback
                if (iconSet === 'tabler') {
                    const tablerIcons = {
                        resolution: '<i class="ti ti-device-tv"></i>',
                        audio: '<i class="ti ti-volume"></i>',
                        hdr: '<i class="ti ti-sun-high"></i>',
                        dolbyVision: '<i class="ti ti-eye"></i>',
                        aspectRatio: '<i class="ti ti-aspect-ratio"></i>',
                    };
                    return tablerIcons[type] || '';
                }

                if (iconSet === 'material') {
                    const materialIcons = {
                        resolution: '<span class="material-symbols-rounded">videocam</span>',
                        audio: '<span class="material-symbols-rounded">volume_up</span>',
                        hdr: '<span class="material-symbols-rounded">hdr_on</span>',
                        dolbyVision: '<span class="material-symbols-rounded">hdr_on</span>',
                        aspectRatio: '<span class="material-symbols-rounded">aspect_ratio</span>',
                    };
                    return materialIcons[type] || '';
                }

                return '';
            };

            // Resolution
            if (specs.showResolution !== false && currentMedia.resolution) {
                const item = document.createElement('div');
                item.className = 'cinema-spec-item';
                item.innerHTML = `${getIcon('resolution', currentMedia.resolution)}<span>${currentMedia.resolution}</span>`;
                specsDiv.appendChild(item);
            }

            // Audio
            if (specs.showAudio !== false && currentMedia.audioCodec) {
                const item = document.createElement('div');
                item.className = 'cinema-spec-item';
                const audioText = currentMedia.audioChannels
                    ? `${currentMedia.audioCodec} ${currentMedia.audioChannels}`
                    : currentMedia.audioCodec;
                item.innerHTML = `${getIcon('audio', audioText)}<span>${audioText}</span>`;
                specsDiv.appendChild(item);
            }

            // HDR
            if (specs.showHDR !== false && (currentMedia.hasHDR || currentMedia.hasDolbyVision)) {
                const item = document.createElement('div');
                item.className = 'cinema-spec-item';
                const isDV = currentMedia.hasDolbyVision;
                const iconType = isDV ? 'dolbyVision' : 'hdr';
                const flagText = isDV ? 'Dolby Vision' : 'HDR';
                item.innerHTML = `${getIcon(iconType)}<span>${flagText}</span>`;
                specsDiv.appendChild(item);
            }

            // Aspect Ratio
            if (specs.showAspectRatio && currentMedia.aspectRatio) {
                const item = document.createElement('div');
                item.className = 'cinema-spec-item';
                item.innerHTML = `${getIcon('aspectRatio', currentMedia.aspectRatio)}<span>${currentMedia.aspectRatio}</span>`;
                specsDiv.appendChild(item);
            }

            const hasSpecs = specsDiv.children.length > 0;

            // Determine layout mode: dual-row (both sections) or single-row (one section only)
            const layoutMode = hasMovieInfo && hasSpecs ? 'dual-row' : 'single-row';
            footerEl.classList.add(layoutMode);

            // Add sections to footer
            if (hasMovieInfo) {
                footerEl.appendChild(movieInfoDiv);
            }
            if (hasSpecs) {
                footerEl.appendChild(specsDiv);
            }

            // Debug: Log all available tech specs data (only when logger.debug is enabled)
            debug('TECH SPECS', {
                title: currentMedia.title,
                resolution: currentMedia.resolution,
                audioCodec: currentMedia.audioCodec,
                audioChannels: currentMedia.audioChannels,
                hasHDR: currentMedia.hasHDR,
                hasDolbyVision: currentMedia.hasDolbyVision,
                aspectRatio: currentMedia.aspectRatio,
                videoStreams: currentMedia.videoStreams?.length || 0,
                audioTracks: currentMedia.audioTracks?.length || 0,
                qualityLabel: currentMedia.qualityLabel,
            });

            log('Cinema footer metadata/specs created', {
                style: specs.style,
                iconSet: specs.iconSet,
                layoutMode,
                hasMovieInfo,
                hasSpecs,
                resolution: currentMedia.resolution || 'N/A',
            });
        } else if (cinemaConfig.footer.type === 'tagline' && currentMedia) {
            // Tagline footer - displays the movie/series tagline
            const taglineText = currentMedia.tagline || currentMedia.summary?.split('.')[0] || '';
            const displayText = taglineText || currentMedia.title || '';

            if (cinemaConfig.footer.taglineMarquee) {
                // Marquee-style tagline - same structure as marquee type
                const marqueeDiv = document.createElement('div');
                marqueeDiv.className = 'cinema-footer-marquee';

                const marqueeContent = document.createElement('div');
                marqueeContent.className = 'cinema-footer-marquee-content';
                marqueeContent.textContent = displayText;

                marqueeDiv.appendChild(marqueeContent);
                footerEl.appendChild(marqueeDiv);

                // Calculate duration and start animation
                startMarquee(marqueeContent, marqueeDiv);

                log('Cinema footer tagline marquee created', {
                    tagline: displayText,
                    isMarquee: true,
                });
            } else {
                // Static tagline display
                const taglineDiv = document.createElement('div');
                taglineDiv.className = 'cinema-footer-tagline';
                taglineDiv.textContent = displayText;

                if (!taglineText) {
                    taglineDiv.classList.add('fallback-title');
                }

                footerEl.appendChild(taglineDiv);

                log('Cinema footer tagline created', {
                    tagline: displayText,
                });
            }
        }
    }

    // ===== Cinema Ambilight =====
    function createAmbilight() {
        if (!cinemaConfig.ambilight.enabled) {
            if (ambilightEl) {
                ambilightEl.classList.remove('active');
            }
            return;
        }

        // Create ambilight element if it doesn't exist
        if (!ambilightEl) {
            ambilightEl = document.createElement('div');
            ambilightEl.className = 'cinema-ambilight';
            document.body.appendChild(ambilightEl);
        }

        // Apply strength via opacity
        const opacity = (cinemaConfig.ambilight.strength / 100).toFixed(2);
        ambilightEl.style.opacity = opacity;
        ambilightEl.classList.add('active');

        log('Cinema ambilight created/updated', { strength: cinemaConfig.ambilight.strength });
    }

    // ===== QR Code (Promotional) =====
    let qrCodeEl = null;
    async function createQRCode(currentMedia) {
        const promo = cinemaConfig.promotional || {};
        const qrConfig = promo.qrCode || {};

        // Remove existing QR code
        if (qrCodeEl) {
            qrCodeEl.remove();
            qrCodeEl = null;
        }

        if (!qrConfig.enabled) {
            return;
        }

        // Determine URL based on urlType setting
        const urlType = qrConfig.urlType || 'trailer';
        let targetUrl = null;

        switch (urlType) {
            case 'trailer':
                // Fetch actual YouTube trailer URL from backend
                if (currentMedia) {
                    const tmdbId =
                        currentMedia.tmdbId ||
                        currentMedia.tmdb_id ||
                        (Array.isArray(currentMedia.guids)
                            ? currentMedia.guids.find(g => g.source === 'tmdb')?.id
                            : null);
                    if (tmdbId) {
                        const type =
                            currentMedia.type === 'show' || currentMedia.type === 'episode'
                                ? 'tv'
                                : 'movie';
                        try {
                            const response = await fetch(
                                `/get-trailer?tmdbId=${tmdbId}&type=${type}`
                            );
                            if (response.ok) {
                                const data = await response.json();
                                if (data.success && data.trailer?.key) {
                                    // Create YouTube watch URL from video key
                                    targetUrl = `https://www.youtube.com/watch?v=${data.trailer.key}`;
                                }
                            }
                        } catch (err) {
                            log('Failed to fetch trailer for QR code', { error: err.message });
                        }
                    }
                }
                break;
            case 'imdb':
                // Use IMDb URL from media metadata
                if (currentMedia) {
                    targetUrl = currentMedia.imdbUrl || null;
                    // Fallback: construct from imdbId if we have it
                    if (!targetUrl && currentMedia.imdbId) {
                        targetUrl = `https://www.imdb.com/title/${currentMedia.imdbId}`;
                    }
                }
                break;
            case 'tmdb':
                // Use TMDB URL
                if (currentMedia) {
                    const tmdbId =
                        currentMedia.tmdbId ||
                        currentMedia.tmdb_id ||
                        (Array.isArray(currentMedia.guids)
                            ? currentMedia.guids.find(g => g.source === 'tmdb')?.id
                            : null);
                    if (tmdbId) {
                        const type =
                            currentMedia.type === 'show' || currentMedia.type === 'episode'
                                ? 'tv'
                                : 'movie';
                        targetUrl = `https://www.themoviedb.org/${type}/${tmdbId}`;
                    }
                }
                break;
            case 'custom':
                // Use custom URL from config
                targetUrl = qrConfig.url || null;
                break;
            default:
                // Fallback to IMDb for backwards compatibility
                if (currentMedia) {
                    targetUrl = currentMedia.imdbUrl || null;
                }
        }

        if (!targetUrl) {
            log('QR Code skipped - no URL available');
            return;
        }

        // Create QR code element
        qrCodeEl = document.createElement('div');
        qrCodeEl.className = `cinema-qr-code position-${qrConfig.position || 'bottomRight'}`;

        // Determine QR code colors - always use ton-sur-ton (never plain white/black)
        const footerTypo = cinemaConfig.footer?.typography || {};
        const intensity = footerTypo.tonSurTonIntensity || 45;
        const bgColorForQR = effectiveBgColor || '#1a1a2e';

        // Always calculate ton-sur-ton colors for QR code
        // Use extra light version for background, extra dark for foreground
        const lightTon = calculateTonSurTonLight(bgColorForQR, intensity);
        const darkTon = calculateTonSurTonDark(bgColorForQR, intensity);

        const qrBgColor = lightTon.replace('#', ''); // Light tinted background (replaces white)
        const qrFgColor = darkTon.replace('#', ''); // Dark tinted foreground (replaces black)

        log('QR Code using ton-sur-ton colors', {
            bgColor: bgColorForQR,
            qrFgColor: darkTon,
            qrBgColor: lightTon,
            intensity,
        });

        // Generate QR code using external API with custom colors
        // Use SVG format for crisp rendering, high resolution, and no margin
        const displaySize = qrConfig.size || 100;
        const renderSize = displaySize * 3; // 3x resolution for sharpness
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${renderSize}x${renderSize}&format=svg&color=${qrFgColor}&bgcolor=${qrBgColor}&margin=0&data=${encodeURIComponent(targetUrl)}`;

        const img = document.createElement('img');
        img.src = qrUrl;
        img.alt = 'QR Code';
        // Use rem for 4K scaling (displaySize / 16 to convert px to rem)
        const sizeInRem = displaySize / 16;
        img.style.width = `${sizeInRem}rem`;
        img.style.height = `${sizeInRem}rem`;
        img.style.display = 'block'; // Remove any inline spacing
        img.loading = 'lazy';

        // Set background color on container to match QR background (lichte ton als rand)
        qrCodeEl.style.backgroundColor = lightTon;

        qrCodeEl.appendChild(img);
        document.body.appendChild(qrCodeEl);

        log('QR Code created', {
            url: targetUrl,
            urlType: urlType,
            position: qrConfig.position,
        });
    }

    // ===== Trailer Overlay (Promotional) =====
    let trailerEl = null;
    let currentTrailerKey = null; // Track current trailer to avoid reloading
    let ytPlayer = null; // YouTube Player instance
    let ytApiReady = false; // Track if YouTube API is loaded
    let trailerDelayTimer = null; // Timer for delayed trailer start
    let trailerLoopCount = 0; // Count trailer loops for autohide
    let trailerAutohideTimer = null; // Timer for time-based autohide
    let trailerReshowTimer = null; // Timer for re-showing trailer
    let trailerHidden = false; // Track if trailer is hidden (autohide active)

    // Load YouTube IFrame API (once)
    function loadYouTubeAPI() {
        return new Promise(resolve => {
            if (ytApiReady) {
                resolve();
                return;
            }
            if (window.YT && window.YT.Player) {
                ytApiReady = true;
                resolve();
                return;
            }
            // Check if script is already being loaded
            if (document.querySelector('script[src*="youtube.com/iframe_api"]')) {
                // Wait for it to load
                const checkReady = setInterval(() => {
                    if (window.YT && window.YT.Player) {
                        ytApiReady = true;
                        clearInterval(checkReady);
                        resolve();
                    }
                }, 100);
                return;
            }
            // Load the API
            const tag = document.createElement('script');
            tag.src = 'https://www.youtube.com/iframe_api';
            const firstScriptTag = document.getElementsByTagName('script')[0];
            firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

            window.onYouTubeIframeAPIReady = () => {
                ytApiReady = true;
                resolve();
            };
        });
    }

    async function createTrailerOverlay(media) {
        const promo = cinemaConfig.promotional || {};
        const trailerConfig = promo.trailer || {};

        // Clear any pending timers
        if (trailerDelayTimer) {
            clearTimeout(trailerDelayTimer);
            trailerDelayTimer = null;
        }
        if (trailerAutohideTimer) {
            clearTimeout(trailerAutohideTimer);
            trailerAutohideTimer = null;
        }
        if (trailerReshowTimer) {
            clearTimeout(trailerReshowTimer);
            trailerReshowTimer = null;
        }

        // Reset state for new trailer
        trailerLoopCount = 0;
        trailerHidden = false;

        // Remove existing trailer if disabled or no media
        if (!trailerConfig.enabled || !media) {
            removeTrailerOverlay();
            return;
        }

        // Get delay in seconds (default 5s)
        const delaySeconds = trailerConfig.delay ?? 5;

        // If delay > 0, schedule the trailer to start after delay
        if (delaySeconds > 0) {
            log('Trailer scheduled', { delay: delaySeconds, title: media.title });
            trailerDelayTimer = setTimeout(() => {
                trailerDelayTimer = null;
                startTrailerPlayback(media, trailerConfig);
            }, delaySeconds * 1000);
        } else {
            // No delay, start immediately
            startTrailerPlayback(media, trailerConfig);
        }
    }

    // Hide trailer (autohide triggered)
    function hideTrailer() {
        trailerHidden = true;
        if (trailerEl) {
            // Fade out smoothly
            trailerEl.classList.remove('visible');
        }
        if (ytPlayer) {
            try {
                // Pause video after fade completes
                setTimeout(() => {
                    if (ytPlayer) ytPlayer.pauseVideo();
                }, 800);
            } catch (e) {
                // Player may not be ready
            }
        }
        log('Trailer hidden (autohide)');
    }

    // Show trailer again (reshow triggered)
    function reshowTrailer() {
        if (!trailerHidden || !trailerEl) return;

        trailerHidden = false;
        trailerLoopCount = 0; // Reset loop count
        // Fade in smoothly
        trailerEl.classList.add('visible');

        if (ytPlayer) {
            try {
                ytPlayer.seekTo(0);
                ytPlayer.playVideo();
            } catch (e) {
                // Player may not be ready
            }
        }

        // Restart autohide timer if time-based
        const promo = cinemaConfig.promotional || {};
        const trailerConfig = promo.trailer || {};
        setupAutohideTimer(trailerConfig);

        log('Trailer re-shown');
    }

    // Setup autohide timer for time-based autohide
    function setupAutohideTimer(trailerConfig) {
        if (trailerAutohideTimer) {
            clearTimeout(trailerAutohideTimer);
            trailerAutohideTimer = null;
        }

        const autohide = trailerConfig.autohide || 'never';
        if (autohide === 'never') return;

        // Time-based autohide
        const timeMatch = autohide.match(/^(\d+)min$/);
        if (timeMatch) {
            const minutes = parseInt(timeMatch[1], 10);
            trailerAutohideTimer = setTimeout(
                () => {
                    trailerAutohideTimer = null;
                    hideTrailer();
                    setupReshowTimer(trailerConfig);
                },
                minutes * 60 * 1000
            );
            log('Trailer autohide timer set', { minutes });
        }
    }

    // Setup reshow timer
    function setupReshowTimer(trailerConfig) {
        if (trailerReshowTimer) {
            clearTimeout(trailerReshowTimer);
            trailerReshowTimer = null;
        }

        const reshow = trailerConfig.reshow || 'never';
        if (reshow === 'never' || reshow === 'nextposter') return;

        // Time-based reshow
        const timeMatch = reshow.match(/^(\d+)min$/);
        if (timeMatch) {
            const minutes = parseInt(timeMatch[1], 10);
            trailerReshowTimer = setTimeout(
                () => {
                    trailerReshowTimer = null;
                    reshowTrailer();
                },
                minutes * 60 * 1000
            );
            log('Trailer reshow timer set', { minutes });
        }
    }

    // Handle trailer loop end (for loop-based autohide)
    function handleTrailerLoopEnd(trailerConfig) {
        trailerLoopCount++;

        const autohide = trailerConfig.autohide || 'never';
        if (autohide === 'never') return;

        // Loop-based autohide
        const loopMatch = autohide.match(/^(\d+)loops?$/);
        if (loopMatch) {
            const targetLoops = parseInt(loopMatch[1], 10);
            log('Trailer loop completed', { count: trailerLoopCount, target: targetLoops });

            if (trailerLoopCount >= targetLoops) {
                hideTrailer();
                setupReshowTimer(trailerConfig);
            }
        }
    }

    async function startTrailerPlayback(media, trailerConfig) {
        // Get TMDB ID from media (can be in different fields or in guids array)
        let tmdbId = media.tmdbId || media.tmdb_id;

        // Check guids array if tmdbId not found directly
        if (!tmdbId && Array.isArray(media.guids)) {
            const tmdbGuid = media.guids.find(g => g.source === 'tmdb');
            if (tmdbGuid) {
                tmdbId = tmdbGuid.id;
            }
        }

        if (!tmdbId) {
            log('Trailer skipped - no TMDB ID', { title: media.title });
            removeTrailerOverlay();
            return;
        }

        // Determine media type (movie or tv)
        const type = media.type === 'show' || media.type === 'episode' ? 'tv' : 'movie';

        // Check if we already have this trailer loaded
        const trailerKey = `${tmdbId}-${type}`;
        if (currentTrailerKey === trailerKey && trailerEl) {
            log('Trailer already loaded for this media');
            return;
        }

        try {
            // Fetch trailer URL from backend
            const response = await fetch(`/get-trailer?tmdbId=${tmdbId}&type=${type}`);
            if (!response.ok) {
                log('Trailer fetch failed', { status: response.status, title: media.title });
                removeTrailerOverlay();
                return;
            }

            const data = await response.json();
            if (!data.success || !data.trailer) {
                log('No trailer available', { title: media.title });
                removeTrailerOverlay();
                return;
            }

            // Load YouTube API if needed
            await loadYouTubeAPI();

            debug('Trailer DOM state (before remove)', {
                trailerElsInDom: document.querySelectorAll('.cinema-trailer-overlay').length,
                ytPlayerDivsInDom: document.querySelectorAll('[id^="yt-trailer-player"]').length,
            });

            // Remove existing trailer - must be synchronous to avoid duplicate player IDs
            removeTrailerOverlaySync();

            debug('Trailer creating new trailer (after remove)', {
                title: media.title,
                trailerKey,
                trailerElsInDom: document.querySelectorAll('.cinema-trailer-overlay').length,
                ytPlayerDivsInDom: document.querySelectorAll('[id^="yt-trailer-player"]').length,
            });

            // Create trailer container
            trailerEl = document.createElement('div');
            trailerEl.className = 'cinema-trailer-overlay';

            // For floating and fullBleed styles, calculate 95% of actual visible poster width
            const posterStyle = cinemaConfig.poster?.style || 'floating';
            if (posterStyle === 'floating' || posterStyle === 'fullBleed') {
                // Get the actual rendered poster element dimensions
                const posterEl = document.getElementById('poster');
                let actualPosterWidth;

                if (posterEl) {
                    // Get the actual rendered dimensions
                    const rect = posterEl.getBoundingClientRect();
                    // The poster image uses background-size: contain, so we need to calculate
                    // the actual image dimensions within the element
                    const elementWidth = rect.width;
                    const elementHeight = rect.height;

                    // Poster aspect ratio is 2:3 (width:height)
                    // Calculate what the poster width would be if it fills the height
                    const widthFromHeight = elementHeight * (2 / 3);
                    // Calculate what the poster height would be if it fills the width
                    const heightFromWidth = elementWidth * 1.5;

                    if (heightFromWidth <= elementHeight) {
                        // Width is limiting - poster fills width
                        actualPosterWidth = elementWidth;
                    } else {
                        // Height is limiting - poster fills height
                        actualPosterWidth = widthFromHeight;
                    }
                } else {
                    // Fallback to viewport calculation
                    const vw = window.innerWidth;
                    const vh = window.innerHeight;
                    const posterWidthByHeight = vh * (2 / 3);
                    const posterHeightByWidth = vw * 1.5;
                    actualPosterWidth = posterHeightByWidth <= vh ? vw : posterWidthByHeight;
                }

                const trailerWidth = Math.round(actualPosterWidth * 0.95);
                trailerEl.style.setProperty('width', trailerWidth + 'px', 'important');
            }

            // Create player container div with unique ID (required by YouTube API)
            const playerId = `yt-trailer-player-${Date.now()}`;
            const playerDiv = document.createElement('div');
            playerDiv.id = playerId;
            trailerEl.appendChild(playerDiv);
            document.body.appendChild(trailerEl);

            debug('Trailer appended to DOM', {
                playerId,
                trailerElsInDom: document.querySelectorAll('.cinema-trailer-overlay').length,
                ytPlayerDivsInDom: document.querySelectorAll('[id^="yt-trailer-player"]').length,
            });

            // Re-apply width after DOM insertion to ensure it sticks
            if (posterStyle === 'floating' || posterStyle === 'fullBleed') {
                const posterEl = document.getElementById('poster');
                if (posterEl) {
                    const rect = posterEl.getBoundingClientRect();
                    const elementHeight = rect.height;
                    const widthFromHeight = elementHeight * (2 / 3);
                    const trailerWidth = Math.round(widthFromHeight * 0.95);
                    trailerEl.style.cssText = `width: ${trailerWidth}px !important;`;
                }
            }

            // Get loop setting and muted setting
            const shouldLoop = trailerConfig.loop !== false;
            // Always mute trailers in admin preview mode (regardless of setting)
            // Check multiple ways: URL param, iframe detection, or Core.isPreviewMode()
            const urlParams = new URLSearchParams(window.location.search);
            const isPreview =
                urlParams.get('preview') === '1' ||
                window.self !== window.top ||
                window.Core?.isPreviewMode?.() ||
                false;
            const shouldMute = isPreview ? true : trailerConfig.muted !== false;
            const quality = trailerConfig.quality || 'default';

            // Create YouTube player using the API with unique player ID
            // Note: Autoplay with sound requires browser flag: chrome://flags/#autoplay-policy → "No user gesture is required"
            debug('Trailer creating YouTube player', { playerId });
            ytPlayer = new window.YT.Player(playerId, {
                videoId: data.trailer.key,
                playerVars: {
                    autoplay: 1,
                    mute: shouldMute ? 1 : 0, // Respect muted setting
                    controls: 0,
                    disablekb: 1,
                    fs: 0,
                    iv_load_policy: 3, // Hide annotations
                    modestbranding: 1,
                    rel: 0,
                    showinfo: 0,
                    playsinline: 1,
                    origin: window.location.origin,
                },
                events: {
                    onReady: event => {
                        debug('Trailer YouTube onReady', {
                            playerState: event.target.getPlayerState?.(),
                            videoUrl: event.target.getVideoUrl?.(),
                            trailerElExists: !!trailerEl,
                            trailerElVisible: trailerEl?.classList.contains('visible'),
                            trailerElsInDom:
                                document.querySelectorAll('.cinema-trailer-overlay').length,
                        });
                        log('YouTube player ready');
                        // Set playback quality if specified
                        if (quality && quality !== 'default') {
                            try {
                                event.target.setPlaybackQuality(quality);
                                log('Trailer quality set', { quality });
                            } catch (e) {
                                log('Could not set trailer quality', { error: e.message });
                            }
                        }
                        event.target.playVideo();
                        // Fade in the trailer overlay smoothly
                        if (trailerEl) {
                            // Small delay to ensure video frame is rendered
                            setTimeout(() => {
                                debug('Trailer adding visible class', {
                                    trailerElExists: !!trailerEl,
                                    trailerElsInDom:
                                        document.querySelectorAll('.cinema-trailer-overlay').length,
                                });
                                trailerEl.classList.add('visible');
                            }, 100);
                        } else {
                            warn('Trailer trailerEl is NULL in onReady callback');
                        }
                        // Setup time-based autohide timer
                        setupAutohideTimer(trailerConfig);
                    },
                    onError: event => {
                        const errorCodes = {
                            2: 'Invalid video ID',
                            5: 'HTML5 player error',
                            100: 'Video not found or private',
                            101: 'Embedding disabled (age-restricted or blocked)',
                            150: 'Embedding disabled (age-restricted or blocked)',
                        };
                        log('YouTube player error - removing trailer', {
                            code: event.data,
                            message: errorCodes[event.data] || 'Unknown error',
                        });
                        // Remove the trailer overlay on any error
                        removeTrailerOverlay();
                    },
                    onStateChange: event => {
                        const stateNames = {
                            [-1]: 'UNSTARTED',
                            [0]: 'ENDED',
                            [1]: 'PLAYING',
                            [2]: 'PAUSED',
                            [3]: 'BUFFERING',
                            [5]: 'CUED',
                        };
                        debug('Trailer YouTube onStateChange', {
                            state: event.data,
                            stateName: stateNames[event.data] || 'UNKNOWN',
                            trailerElExists: !!trailerEl,
                            trailerElVisible: trailerEl?.classList.contains('visible'),
                        });

                        // Video ended
                        if (event.data === window.YT.PlayerState.ENDED) {
                            // Handle loop-based autohide
                            handleTrailerLoopEnd(trailerConfig);

                            // Loop video (if enabled and not hidden)
                            if (shouldLoop && !trailerHidden) {
                                event.target.seekTo(0);
                                event.target.playVideo();
                            }
                        }
                    },
                },
            });

            currentTrailerKey = trailerKey;

            log('Trailer overlay created (YouTube API)', {
                title: media.title,
                trailerName: data.trailer.name,
                muted: trailerConfig.muted,
                loop: shouldLoop,
            });
        } catch (err) {
            log('Trailer error', { error: err.message, title: media.title });
            removeTrailerOverlay();
        }
    }

    function removeTrailerOverlay() {
        debug('Trailer removeTrailerOverlay called', {
            hasTrailerEl: !!trailerEl,
            hasYtPlayer: !!ytPlayer,
            currentTrailerKey,
            trailerElInDom: document.querySelectorAll('.cinema-trailer-overlay').length,
            ytPlayerDivInDom: document.querySelectorAll('#yt-trailer-player').length,
        });

        // Clear all timers
        if (trailerDelayTimer) {
            clearTimeout(trailerDelayTimer);
            trailerDelayTimer = null;
        }
        if (trailerAutohideTimer) {
            clearTimeout(trailerAutohideTimer);
            trailerAutohideTimer = null;
        }
        if (trailerReshowTimer) {
            clearTimeout(trailerReshowTimer);
            trailerReshowTimer = null;
        }

        // Destroy YouTube player if exists
        if (ytPlayer) {
            try {
                debug('Trailer destroying YouTube player');
                ytPlayer.destroy();
            } catch (e) {
                warn('Trailer error destroying YouTube player', { message: e?.message });
            }
            ytPlayer = null;
        }
        if (trailerEl) {
            // Fade out before removing
            trailerEl.classList.remove('visible');
            const el = trailerEl;
            trailerEl = null;
            currentTrailerKey = null;
            // Remove after fade-out transition completes
            debug('Trailer scheduling trailerEl removal', { delayMs: 800 });
            setTimeout(() => {
                debug('Trailer removing old trailerEl from DOM', {
                    elStillExists: document.body.contains(el),
                    trailerElsInDom: document.querySelectorAll('.cinema-trailer-overlay').length,
                });
                el.remove();
            }, 800);
        }

        // Reset state
        trailerLoopCount = 0;
        trailerHidden = false;
    }

    // Synchronous version that removes immediately (used when creating new trailer)
    function removeTrailerOverlaySync() {
        debug('Trailer removeTrailerOverlaySync called', {
            hasTrailerEl: !!trailerEl,
            hasYtPlayer: !!ytPlayer,
            currentTrailerKey,
            trailerElInDom: document.querySelectorAll('.cinema-trailer-overlay').length,
        });

        // Clear all timers
        if (trailerDelayTimer) {
            clearTimeout(trailerDelayTimer);
            trailerDelayTimer = null;
        }
        if (trailerAutohideTimer) {
            clearTimeout(trailerAutohideTimer);
            trailerAutohideTimer = null;
        }
        if (trailerReshowTimer) {
            clearTimeout(trailerReshowTimer);
            trailerReshowTimer = null;
        }

        // Destroy YouTube player if exists
        if (ytPlayer) {
            try {
                debug('Trailer destroying YouTube player (sync)');
                ytPlayer.destroy();
            } catch (e) {
                warn('Trailer error destroying YouTube player (sync)', { message: e?.message });
            }
            ytPlayer = null;
        }

        // Remove element IMMEDIATELY (no fade-out delay) to prevent duplicate IDs
        if (trailerEl) {
            debug('Trailer removing trailerEl from DOM immediately');
            trailerEl.remove();
            trailerEl = null;
            currentTrailerKey = null;
        }

        // Also clean up any orphaned trailer overlays (safety net)
        document.querySelectorAll('.cinema-trailer-overlay').forEach(el => {
            debug('Trailer cleaning up orphaned trailer overlay');
            el.remove();
        });

        // Reset state
        trailerLoopCount = 0;
        trailerHidden = false;
    }

    // ===== Rating Badge (Promotional) =====
    let ratingBadgeEl = null;
    function createRatingBadge(media) {
        const promo = cinemaConfig.promotional || {};

        // Remove existing badge
        if (ratingBadgeEl) {
            ratingBadgeEl.remove();
            ratingBadgeEl = null;
        }

        if (!promo.showRating || !media) {
            return;
        }

        // Get rating from media - check multiple possible field names
        // RT score can be in: rottenTomatoes.rating, rottenTomatoesScore, rtScore
        const rtScore = media.rottenTomatoes?.rating || media.rottenTomatoesScore || media.rtScore;
        // IMDB/general rating can be in: imdbRating, rating, audienceScore
        const imdbRating = media.imdbRating || media.rating || media.audienceScore;

        if (!rtScore && !imdbRating) {
            log('Rating badge skipped - no rating data', { media: media.title });
            return;
        }

        ratingBadgeEl = document.createElement('div');
        ratingBadgeEl.className = 'cinema-rating-badge';

        if (rtScore) {
            const isFresh = rtScore >= 60;
            ratingBadgeEl.innerHTML = `
                <span class="rating-icon ${isFresh ? 'fresh' : 'rotten'}">${isFresh ? '🍅' : '🤢'}</span>
                <span class="rating-value">${rtScore}%</span>
            `;
            ratingBadgeEl.classList.add(isFresh ? 'fresh' : 'rotten');
        } else if (imdbRating) {
            const ratingNum = typeof imdbRating === 'number' ? imdbRating : parseFloat(imdbRating);
            ratingBadgeEl.innerHTML = `
                <span class="rating-icon imdb">⭐</span>
                <span class="rating-value">${ratingNum.toFixed(1)}</span>
            `;
            ratingBadgeEl.classList.add('imdb');
        }

        document.body.appendChild(ratingBadgeEl);
        log('Rating badge created', { rtScore, imdbRating, title: media.title });
    }

    // ===== Watch Providers (Promotional) =====
    let watchProvidersEl = null;
    function createWatchProviders(media) {
        const promo = cinemaConfig.promotional || {};

        // Remove existing element
        if (watchProvidersEl) {
            watchProvidersEl.remove();
            watchProvidersEl = null;
        }

        if (!promo.showWatchProviders || !media) {
            return;
        }

        // Get watch providers from media (if available from TMDB enrichment)
        const providers = media.watchProviders || media.streamingServices || [];

        if (!providers || providers.length === 0) {
            return;
        }

        watchProvidersEl = document.createElement('div');
        watchProvidersEl.className = 'cinema-watch-providers';

        const label = document.createElement('span');
        label.className = 'providers-label';
        label.textContent = 'Available on';
        watchProvidersEl.appendChild(label);

        const providersList = document.createElement('div');
        providersList.className = 'providers-list';

        providers.slice(0, 4).forEach(provider => {
            const providerEl = document.createElement('span');
            providerEl.className = 'provider-item';
            if (provider.logo) {
                const img = document.createElement('img');
                img.src = provider.logo;
                img.alt = provider.name || 'Streaming service';
                img.loading = 'lazy';
                providerEl.appendChild(img);
            } else {
                providerEl.textContent = provider.name || provider;
            }
            providersList.appendChild(providerEl);
        });

        watchProvidersEl.appendChild(providersList);
        document.body.appendChild(watchProvidersEl);
        log('Watch providers created', { count: providers.length });
    }

    // ===== Awards Badge (Promotional) =====
    let awardsBadgeEl = null;
    function createAwardsBadge(media) {
        const promo = cinemaConfig.promotional || {};

        // Remove existing badge
        if (awardsBadgeEl) {
            awardsBadgeEl.remove();
            awardsBadgeEl = null;
        }

        if (!promo.showAwardsBadge || !media) {
            return;
        }

        // Get RT score to determine "critically acclaimed"
        const rtScore = media.rottenTomatoes?.rating || media.rottenTomatoesScore || media.rtScore;

        // Check for awards data - use RT score >= 90 as proxy for critically acclaimed
        const hasAwards =
            media.awards ||
            media.oscarWinner ||
            media.oscarNominated ||
            media.emmyWinner ||
            media.goldenGlobeWinner ||
            (rtScore && rtScore >= 90);

        if (!hasAwards) {
            log('Awards badge skipped - no awards data', { media: media.title, rtScore });
            return;
        }

        awardsBadgeEl = document.createElement('div');
        awardsBadgeEl.className = 'cinema-awards-badge';

        let badgeText = 'Award Winner';
        let badgeIcon = '🏆';

        if (media.oscarWinner) {
            badgeText = 'Oscar Winner';
            badgeIcon = '🏆';
        } else if (media.oscarNominated) {
            badgeText = 'Oscar Nominated';
            badgeIcon = '🎬';
        } else if (media.emmyWinner) {
            badgeText = 'Emmy Winner';
            badgeIcon = '📺';
        } else if (media.goldenGlobeWinner) {
            badgeText = 'Golden Globe Winner';
            badgeIcon = '🌟';
        } else if (media.awards) {
            badgeText = media.awards;
        } else if (rtScore && rtScore >= 90) {
            badgeText = 'Critically Acclaimed';
            badgeIcon = '⭐';
        }

        awardsBadgeEl.innerHTML = `
            <span class="award-icon">${badgeIcon}</span>
            <span class="award-text">${badgeText}</span>
        `;

        document.body.appendChild(awardsBadgeEl);
        log('Awards badge created', { text: badgeText, title: media.title });
    }

    // ===== Typography Settings (Global CSS Variables) =====

    /**
     * Calculate ton-sur-ton (tonal) color based on background color.
     * Creates an elegant, readable text color in the same hue family.
     * @param {string} bgColor - Background color in hex format
     * @param {number} intensity - Intensity level (10-100), default 15
     * @returns {string} Calculated text color in hex format
     */
    function calculateTonSurTon(bgColor, intensity = 15) {
        // Parse hex color
        let hex = (bgColor || '#000000').replace('#', '');
        if (hex.length === 3) {
            hex = hex
                .split('')
                .map(c => c + c)
                .join('');
        }
        const r = parseInt(hex.substr(0, 2), 16) || 0;
        const g = parseInt(hex.substr(2, 2), 16) || 0;
        const b = parseInt(hex.substr(4, 2), 16) || 0;

        // Convert to HSL
        const rNorm = r / 255;
        const gNorm = g / 255;
        const bNorm = b / 255;
        const max = Math.max(rNorm, gNorm, bNorm);
        const min = Math.min(rNorm, gNorm, bNorm);
        let h = 0;
        let s = 0;
        const l = (max + min) / 2;

        if (max !== min) {
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

        // Ton-sur-ton: elegant harmonious color with good readability
        // Goal: text that feels like it "belongs" with the background but is still readable
        // Intensity ranges from 10 (subtle) to 100 (maximum color)
        let newL;
        let newS;

        // Normalize intensity to 0-1 range (10 = 0, 100 = 1)
        const intensityNorm = (intensity - 10) / 90;

        // Calculate saturation based on intensity
        // Level 10: subtle (12-30%), Level 15: balanced (45-70%), Level 100: full (80-95%)
        const minSat = 0.12 + intensityNorm * 0.68; // 0.12 to 0.80
        const maxSat = 0.3 + intensityNorm * 0.65; // 0.30 to 0.95
        const satMultiplier = 0.35 + intensityNorm * 0.65; // 0.35 to 1.0

        // Calculate lightness based on intensity
        // Higher intensity = less extreme lightness = more color visible
        const lightAdjust = intensityNorm * 0.23; // 0 to 0.23
        const darkAdjust = intensityNorm * 0.22; // 0 to 0.22

        // Use a high threshold - only truly light backgrounds get dark text
        // Most movie poster backgrounds are dark/medium, so we favor light text
        const useLightText = luminance < 180;

        if (useLightText) {
            // Dark/medium background: warm tinted light color
            newL = 0.88 - lightAdjust; // 0.88 (level 10) to 0.65 (level 100)
            newS = Math.max(minSat, Math.min(s * satMultiplier, maxSat));
        } else {
            // Light background: rich dark shade with color depth
            newL = 0.18 + darkAdjust; // 0.18 (level 10) to 0.40 (level 100)
            newS = Math.max(minSat, Math.min(s * satMultiplier, maxSat));
        }

        // Convert HSL back to RGB
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };

        let newR, newG, newB;
        if (newS === 0) {
            newR = newG = newB = newL;
        } else {
            const q = newL < 0.5 ? newL * (1 + newS) : newL + newS - newL * newS;
            const p = 2 * newL - q;
            newR = hue2rgb(p, q, h + 1 / 3);
            newG = hue2rgb(p, q, h);
            newB = hue2rgb(p, q, h - 1 / 3);
        }

        const result = `#${Math.round(newR * 255)
            .toString(16)
            .padStart(2, '0')}${Math.round(newG * 255)
            .toString(16)
            .padStart(2, '0')}${Math.round(newB * 255)
            .toString(16)
            .padStart(2, '0')}`;

        return result;
    }

    /**
     * Calculate a DARK ton-sur-ton color (for QR code foreground).
     * Always produces a dark color regardless of background luminance.
     * @param {string} bgColor - Background color in hex format
     * @param {number} intensity - Intensity level (10-100), default 45
     * @returns {string} Calculated dark color in hex format
     */
    function calculateTonSurTonDark(bgColor, intensity = 45) {
        // Parse hex color
        let hex = (bgColor || '#000000').replace('#', '');
        if (hex.length === 3) {
            hex = hex
                .split('')
                .map(c => c + c)
                .join('');
        }
        const r = parseInt(hex.substr(0, 2), 16) || 0;
        const g = parseInt(hex.substr(2, 2), 16) || 0;
        const b = parseInt(hex.substr(4, 2), 16) || 0;

        // Convert to HSL
        const rNorm = r / 255;
        const gNorm = g / 255;
        const bNorm = b / 255;
        const max = Math.max(rNorm, gNorm, bNorm);
        const min = Math.min(rNorm, gNorm, bNorm);
        let h = 0;
        let s = 0;

        if (max !== min) {
            const d = max - min;
            s = (max + min) / 2 > 0.5 ? d / (2 - max - min) : d / (max + min);
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

        // Normalize intensity to 0-1 range (10 = 0, 100 = 1)
        const intensityNorm = (intensity - 10) / 90;

        // Calculate saturation based on intensity
        const minSat = 0.15 + intensityNorm * 0.55;
        const maxSat = 0.35 + intensityNorm * 0.5;
        const satMultiplier = 0.4 + intensityNorm * 0.55;

        // Extra dark lightness for QR code foreground - needs good contrast
        const darkAdjust = intensityNorm * 0.1; // Less adjustment = stays darker
        const newL = 0.08 + darkAdjust; // 0.08 to 0.18 (very dark)
        const newS = Math.max(minSat, Math.min(s * satMultiplier, maxSat));

        // Convert HSL back to RGB
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };

        let newR, newG, newB;
        if (newS === 0) {
            newR = newG = newB = newL;
        } else {
            const q = newL < 0.5 ? newL * (1 + newS) : newL + newS - newL * newS;
            const p = 2 * newL - q;
            newR = hue2rgb(p, q, h + 1 / 3);
            newG = hue2rgb(p, q, h);
            newB = hue2rgb(p, q, h - 1 / 3);
        }

        return `#${Math.round(newR * 255)
            .toString(16)
            .padStart(2, '0')}${Math.round(newG * 255)
            .toString(16)
            .padStart(2, '0')}${Math.round(newB * 255)
            .toString(16)
            .padStart(2, '0')}`;
    }

    /**
     * Calculate a LIGHT ton-sur-ton color (for QR code background).
     * Always produces an extra light color regardless of background luminance.
     * @param {string} bgColor - Background color in hex format
     * @param {number} intensity - Intensity level (10-100), default 45
     * @returns {string} Calculated light color in hex format
     */
    function calculateTonSurTonLight(bgColor, intensity = 45) {
        // Parse hex color
        let hex = (bgColor || '#000000').replace('#', '');
        if (hex.length === 3) {
            hex = hex
                .split('')
                .map(c => c + c)
                .join('');
        }
        const r = parseInt(hex.substr(0, 2), 16) || 0;
        const g = parseInt(hex.substr(2, 2), 16) || 0;
        const b = parseInt(hex.substr(4, 2), 16) || 0;

        // Convert to HSL
        const rNorm = r / 255;
        const gNorm = g / 255;
        const bNorm = b / 255;
        const max = Math.max(rNorm, gNorm, bNorm);
        const min = Math.min(rNorm, gNorm, bNorm);
        let h = 0;
        let s = 0;

        if (max !== min) {
            const d = max - min;
            s = (max + min) / 2 > 0.5 ? d / (2 - max - min) : d / (max + min);
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

        // Normalize intensity to 0-1 range (10 = 0, 100 = 1)
        const intensityNorm = (intensity - 10) / 90;

        // Calculate saturation - subtle tint for light background
        const minSat = 0.08 + intensityNorm * 0.2; // 0.08 to 0.28
        const maxSat = 0.15 + intensityNorm * 0.25; // 0.15 to 0.40
        const satMultiplier = 0.25 + intensityNorm * 0.45;

        // Extra light lightness for QR code background - needs good contrast
        const lightAdjust = intensityNorm * 0.08; // Less adjustment = stays lighter
        const newL = 0.95 - lightAdjust; // 0.95 to 0.87 (very light)
        const newS = Math.max(minSat, Math.min(s * satMultiplier, maxSat));

        // Convert HSL back to RGB
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };

        let newR, newG, newB;
        if (newS === 0) {
            newR = newG = newB = newL;
        } else {
            const q = newL < 0.5 ? newL * (1 + newS) : newL + newS - newL * newS;
            const p = 2 * newL - q;
            newR = hue2rgb(p, q, h + 1 / 3);
            newG = hue2rgb(p, q, h);
            newB = hue2rgb(p, q, h - 1 / 3);
        }

        return `#${Math.round(newR * 255)
            .toString(16)
            .padStart(2, '0')}${Math.round(newG * 255)
            .toString(16)
            .padStart(2, '0')}${Math.round(newB * 255)
            .toString(16)
            .padStart(2, '0')}`;
    }

    function applyTypographySettings() {
        const root = document.documentElement;

        // Font family mapping for header/footer
        const fontMap = {
            system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            cinematic: '"Bebas Neue", "Impact", sans-serif',
            classic: '"Playfair Display", Georgia, serif',
            modern: '"Montserrat", "Helvetica Neue", sans-serif',
            elegant: '"Cormorant Garamond", "Times New Roman", serif',
            marquee: '"Broadway", "Impact", fantasy',
            retro: '"Press Start 2P", "Courier New", monospace',
            neon: '"Tilt Neon", "Impact", sans-serif',
            scifi: '"Space Grotesk", "Helvetica Neue", sans-serif',
            poster: '"Oswald", "Impact", sans-serif',
            epic: '"Cinzel", "Times New Roman", serif',
            bold: '"Lilita One", "Impact", sans-serif',
        };

        // Header typography
        const headerTypo = cinemaConfig.header?.typography || {};
        root.style.setProperty(
            '--header-font-family',
            fontMap[headerTypo.fontFamily] || fontMap.cinematic
        );

        // Footer typography
        const footerTypo = cinemaConfig.footer?.typography || {};
        root.style.setProperty(
            '--footer-font-family',
            fontMap[footerTypo.fontFamily] || fontMap.system
        );

        // Metadata opacity from metadata settings
        const meta = cinemaConfig.metadata || {};
        root.style.setProperty(
            '--cinema-metadata-opacity',
            ((meta.opacity || 80) / 100).toFixed(2)
        );

        // Shadow presets for header
        const shadowMap = {
            none: 'none',
            subtle: '0 2px 4px rgba(0,0,0,0.5)',
            dramatic: '0 4px 8px rgba(0,0,0,0.8), 0 8px 16px rgba(0,0,0,0.4)',
            neon: '0 0 10px currentColor, 0 0 20px currentColor, 0 0 40px currentColor',
            glow: '0 0 15px rgba(255,255,255,0.5), 0 0 30px rgba(255,255,255,0.3)',
        };
        root.style.setProperty('--header-shadow', shadowMap[headerTypo.shadow] || shadowMap.subtle);
        root.style.setProperty('--footer-shadow', shadowMap[footerTypo.shadow] || 'none');

        log('Typography settings applied', { header: headerTypo, footer: footerTypo });
    }

    // ===== Create Darker Color Variant =====
    function createDarkerColor(hexColor) {
        // Parse hex color
        const hex = hexColor.replace('#', '');
        const r = Math.max(0, Math.round(parseInt(hex.substring(0, 2), 16) * 0.4));
        const g = Math.max(0, Math.round(parseInt(hex.substring(2, 4), 16) * 0.4));
        const b = Math.max(0, Math.round(parseInt(hex.substring(4, 6), 16) * 0.4));
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    // ===== Create Ton-sur-ton Frame Color =====
    // Creates a frame color based on the dominant color of the poster
    // Light variant: brightens and desaturates slightly for a subtle frame
    // Dark variant: darkens and desaturates for a subtle shadow effect
    function createTonSurTonColor(hexColor, variant = 'light') {
        const hex = hexColor.replace('#', '');
        let r = parseInt(hex.substring(0, 2), 16);
        let g = parseInt(hex.substring(2, 4), 16);
        let b = parseInt(hex.substring(4, 6), 16);

        if (variant === 'light') {
            // Lighten: move 40% toward white, slight desaturation
            r = Math.min(255, Math.round(r + (255 - r) * 0.4));
            g = Math.min(255, Math.round(g + (255 - g) * 0.4));
            b = Math.min(255, Math.round(b + (255 - b) * 0.4));
        } else {
            // Darken: move 50% toward black
            r = Math.round(r * 0.5);
            g = Math.round(g * 0.5);
            b = Math.round(b * 0.5);
        }

        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    // ===== Update Frame Color for Ton-sur-ton =====
    // Called after dominantColor is extracted to update frame color dynamically
    function updateTonSurTonFrameColor(dominantColor) {
        const poster = cinemaConfig.poster;
        if (!poster.frameColorMode || poster.frameColorMode === 'custom') {
            return; // Use custom color, no update needed
        }

        const variant = poster.frameColorMode === 'tonSurTonLight' ? 'light' : 'dark';
        const tonSurTonColor = createTonSurTonColor(dominantColor, variant);
        document.documentElement.style.setProperty('--cinema-frame-color', tonSurTonColor);
        log('Ton-sur-ton frame color applied:', {
            variant,
            dominantColor,
            frameColor: tonSurTonColor,
        });
    }

    // ===== Extract Dominant Color from Image =====
    function extractDominantColor(imageUrl) {
        return new Promise(resolve => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    // Sample a small area for performance
                    canvas.width = 50;
                    canvas.height = 75;
                    ctx.drawImage(img, 0, 0, 50, 75);
                    const data = ctx.getImageData(0, 0, 50, 75).data;

                    // Calculate average color
                    let r = 0,
                        g = 0,
                        b = 0,
                        count = 0;
                    for (let i = 0; i < data.length; i += 4) {
                        // Skip very dark and very light pixels
                        const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
                        if (brightness > 30 && brightness < 220) {
                            r += data[i];
                            g += data[i + 1];
                            b += data[i + 2];
                            count++;
                        }
                    }

                    if (count > 0) {
                        r = Math.round(r / count);
                        g = Math.round(g / count);
                        b = Math.round(b / count);
                        const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
                        resolve(hex);
                    } else {
                        resolve('#2a2a4a'); // Default fallback
                    }
                } catch (e) {
                    resolve('#2a2a4a'); // CORS or other error
                }
            };
            img.onerror = () => resolve('#2a2a4a');
            img.src = imageUrl;
        });
    }

    // ===== Starfield Background Manager =====
    let starfieldCanvas = null;
    let starfieldCtx = null;
    let starfieldAnimationId = null;
    let stars = [];

    function manageStarfield(enabled) {
        if (enabled && !starfieldCanvas) {
            // Create canvas for starfield
            starfieldCanvas = document.createElement('canvas');
            starfieldCanvas.id = 'cinema-starfield';
            starfieldCanvas.style.cssText =
                'position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none;';
            document.body.insertBefore(starfieldCanvas, document.body.firstChild);
            starfieldCtx = starfieldCanvas.getContext('2d');

            // Initialize stars
            const resize = () => {
                starfieldCanvas.width = window.innerWidth;
                starfieldCanvas.height = window.innerHeight;
                initStars();
            };
            window.addEventListener('resize', resize);
            resize();

            // Start animation
            animateStarfield();
        } else if (!enabled && starfieldCanvas) {
            // Remove canvas
            if (starfieldAnimationId) cancelAnimationFrame(starfieldAnimationId);
            starfieldCanvas.remove();
            starfieldCanvas = null;
            starfieldCtx = null;
            starfieldAnimationId = null;
            stars = [];
        }
    }

    function initStars() {
        stars = [];
        const numStars = Math.floor((starfieldCanvas.width * starfieldCanvas.height) / 4000);
        for (let i = 0; i < numStars; i++) {
            stars.push({
                x: Math.random() * starfieldCanvas.width,
                y: Math.random() * starfieldCanvas.height,
                radius: Math.random() * 1.5 + 0.5,
                alpha: Math.random() * 0.8 + 0.2,
                speed: Math.random() * 0.02 + 0.005,
                twinkleSpeed: Math.random() * 0.03 + 0.01,
                twinklePhase: Math.random() * Math.PI * 2,
            });
        }
    }

    function animateStarfield() {
        if (!starfieldCtx || !starfieldCanvas) return;

        starfieldCtx.fillStyle = '#000';
        starfieldCtx.fillRect(0, 0, starfieldCanvas.width, starfieldCanvas.height);

        stars.forEach(star => {
            // Twinkle effect
            star.twinklePhase += star.twinkleSpeed;
            const twinkle = Math.sin(star.twinklePhase) * 0.3 + 0.7;
            const alpha = star.alpha * twinkle;

            starfieldCtx.beginPath();
            starfieldCtx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
            starfieldCtx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
            starfieldCtx.fill();

            // Slow drift
            star.y += star.speed;
            if (star.y > starfieldCanvas.height) {
                star.y = 0;
                star.x = Math.random() * starfieldCanvas.width;
            }
        });

        starfieldAnimationId = requestAnimationFrame(animateStarfield);
    }

    // ===== Background Settings =====
    async function applyBackgroundSettings(media, opts = {}) {
        const root = document.documentElement;
        const bg = cinemaConfig.background;

        // Apply background mode class
        document.body.classList.remove(
            'cinema-bg-solid',
            'cinema-bg-blurred',
            'cinema-bg-gradient',
            'cinema-bg-ambient',
            'cinema-bg-spotlight',
            'cinema-bg-starfield',
            'cinema-bg-curtain'
        );
        document.body.classList.add(`cinema-bg-${bg.mode}`);

        // Create/manage starfield canvas for that mode
        manageStarfield(bg.mode === 'starfield');

        // Set CSS variables (use rem for 4K scaling)
        root.style.setProperty('--cinema-bg-color', bg.solidColor);
        root.style.setProperty('--cinema-bg-blur', `${bg.blurAmount / 16}rem`);

        // Track effective background color for ton-sur-ton
        // Start with solid color as default
        effectiveBgColor = bg.solidColor || '#000000';

        // Check if ton-sur-ton frame color is enabled
        const needsTonSurTon =
            cinemaConfig.poster.frameColorMode && cinemaConfig.poster.frameColorMode !== 'custom';

        // If ton-sur-ton frame color is enabled, set an immediate non-custom frame color based on
        // the current effective background, so we never flash the custom color at boot.
        if (needsTonSurTon) {
            const mode = cinemaConfig.poster.frameColorMode;
            const variant = mode === 'tonSurTonLight' ? 'light' : 'dark';
            const base =
                typeof effectiveBgColor === 'string' && /^#?[0-9a-fA-F]{6}$/.test(effectiveBgColor)
                    ? effectiveBgColor
                    : '#000000';
            root.style.setProperty('--cinema-frame-color', createTonSurTonColor(base, variant));
        }

        // Set poster URL for blurred background
        if (media) {
            const posterUrl =
                media.posterUrl ||
                media.poster_path ||
                media.thumbnailUrl ||
                media.thumbnail_url ||
                '';
            if (posterUrl) {
                root.style.setProperty('--cinema-poster-url', `url('${posterUrl}')`);

                // Extract dominant color if not provided
                // Also extract if ton-sur-ton is enabled (for frame color)
                let dominantColor = media.dominantColor;
                if (
                    !dominantColor &&
                    (bg.mode === 'gradient' ||
                        bg.mode === 'ambient' ||
                        bg.mode === 'blurred' ||
                        needsTonSurTon)
                ) {
                    // Prefer sampling a low-res thumbnail when available for faster stabilization.
                    // This reduces the brief "background/color then correct" flash on first paint.
                    const sampleUrl = opts.samplePosterUrl || posterUrl;
                    dominantColor = await extractDominantColor(sampleUrl);
                    log('Extracted dominant color:', dominantColor);
                }
                dominantColor = dominantColor || '#4a4a7a';

                // Update effective background color for dynamic modes
                if (bg.mode === 'gradient' || bg.mode === 'ambient' || bg.mode === 'blurred') {
                    effectiveBgColor = dominantColor;
                }

                // Set gradient/ambient colors - create a darker variant for smooth gradient
                root.style.setProperty('--cinema-ambient-color', dominantColor);
                // Create darker variant of the color
                const darkerColor = createDarkerColor(dominantColor);
                root.style.setProperty('--cinema-ambient-color-dark', darkerColor);
                root.style.setProperty('--cinema-gradient-start', '#0f0f0f');
                root.style.setProperty('--cinema-gradient-mid', dominantColor);
                root.style.setProperty('--cinema-gradient-end', '#0f0f0f');

                // Update ton-sur-ton frame color if enabled
                if (needsTonSurTon) {
                    updateTonSurTonFrameColor(dominantColor);
                }

                // Update timeline border auto color
                updateTimelineBorderAutoColor(dominantColor);
            }
        }

        // Vignette presets
        const vignetteMap = {
            none: 'none',
            subtle: 'radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.4) 100%)',
            dramatic: 'radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.8) 100%)',
        };
        root.style.setProperty('--cinema-vignette', vignetteMap[bg.vignette] || vignetteMap.subtle);

        log('Background settings applied', { ...bg, effectiveBgColor });
    }

    // ===== Transition Selection =====
    // All available transitions
    const LEGACY_TRANSITION_MAP = {
        zoomIn: 'dollyIn',
        spotlight: 'lensIris',
        rackFocus: 'cinematic',
        lightSweep: 'lightFlare',
        smokeFade: 'fade',
    };
    const mapTransition = t => (LEGACY_TRANSITION_MAP[t] ? LEGACY_TRANSITION_MAP[t] : t);

    const ALL_TRANSITIONS = [
        'fade',
        'slideUp',
        'cinematic',
        'lightFlare',
        'shatter',
        'unfold',
        'swing',
        'ripple',
        'curtainReveal',
        'filmGate',
        'projectorFlicker',
        'parallaxFloat',
        'dollyIn',
        'splitFlap',
        'lensIris',
    ];

    // Genre to transition mapping for smart mode
    const GENRE_TRANSITION_MAP = {
        action: ['shatter', 'swing', 'dollyIn', 'filmGate'],
        adventure: ['unfold', 'slideUp', 'dollyIn', 'parallaxFloat'],
        thriller: ['lensIris', 'shatter', 'cinematic', 'projectorFlicker'],
        horror: ['shatter', 'lensIris', 'ripple', 'projectorFlicker'],
        comedy: ['swing', 'slideUp', 'fade', 'splitFlap'],
        romance: ['fade', 'lightFlare', 'unfold', 'lensIris', 'dollyIn'],
        drama: ['cinematic', 'fade', 'lensIris', 'dollyIn', 'unfold'],
        documentary: ['fade', 'slideUp', 'cinematic', 'filmGate'],
        animation: ['swing', 'ripple', 'dollyIn', 'splitFlap'],
        fantasy: ['lightFlare', 'unfold', 'ripple', 'lensIris'],
        'sci-fi': ['lightFlare', 'shatter', 'ripple', 'lensIris', 'filmGate'],
        'science fiction': ['lightFlare', 'shatter', 'ripple', 'lensIris', 'filmGate'],
        mystery: ['lensIris', 'cinematic', 'fade', 'filmGate'],
        crime: ['lensIris', 'shatter', 'cinematic', 'filmGate'],
        family: ['fade', 'slideUp', 'swing', 'curtainReveal'],
        music: ['ripple', 'lightFlare', 'swing', 'projectorFlicker'],
        war: ['shatter', 'cinematic', 'lensIris', 'filmGate'],
        western: ['unfold', 'slideUp', 'cinematic', 'curtainReveal'],
        history: ['unfold', 'fade', 'cinematic', 'filmGate'],
    };

    /**
     * Select the next transition based on the configured selection mode.
     * @param {Object} media - Current media object (for smart mode genre matching)
     * @returns {string} - The selected transition name
     */
    function selectTransition(media = null) {
        const transitions = cinemaConfig.poster?.cinematicTransitions || {};
        const mode = transitions.selectionMode || 'random';
        const enabledTransitions = (transitions.enabledTransitions || ['fade']).map(t =>
            mapTransition(t)
        );
        const singleTransition = mapTransition(transitions.singleTransition || 'fade');

        // Filter to only include valid transitions
        const validTransitions = enabledTransitions.filter(t => ALL_TRANSITIONS.includes(t));
        if (validTransitions.length === 0) {
            return 'fade'; // Fallback
        }

        switch (mode) {
            case 'single':
                // Use the specified single transition
                return ALL_TRANSITIONS.includes(singleTransition)
                    ? singleTransition
                    : validTransitions[0] || 'fade';

            case 'sequential': {
                // Cycle through enabled transitions in order
                const transition =
                    validTransitions[sequentialTransitionIndex % validTransitions.length];
                sequentialTransitionIndex++;
                return transition;
            }

            case 'smart':
                // Match transition to media genre
                if (media && media.genres && Array.isArray(media.genres)) {
                    const genre = (media.genres[0] || '').toLowerCase();
                    const genreTransitions = GENRE_TRANSITION_MAP[genre] || [];
                    // Find first genre-appropriate transition that's enabled
                    for (const t of genreTransitions) {
                        if (validTransitions.includes(t)) {
                            return t;
                        }
                    }
                }
                // Fallback to random if no genre match
                return validTransitions[Math.floor(Math.random() * validTransitions.length)];

            case 'random':
            default:
                // Random selection from enabled transitions
                return validTransitions[Math.floor(Math.random() * validTransitions.length)];
        }
    }

    // ===== Poster Settings =====
    function applyPosterSettings() {
        const root = document.documentElement;
        const poster = cinemaConfig.poster;

        // Remove existing poster style classes
        document.body.classList.remove(
            'cinema-poster-fullBleed',
            'cinema-poster-framed',
            'cinema-poster-floating',
            'cinema-poster-polaroid',
            'cinema-poster-shadowBox',
            'cinema-poster-neon',
            'cinema-poster-doubleBorder',
            'cinema-poster-ornate'
        );
        const posterStyleClass = `cinema-poster-${poster.style}`;
        document.body.classList.add(posterStyleClass);

        // Remove existing overlay classes
        document.body.classList.remove(
            'cinema-overlay-none',
            'cinema-overlay-grain',
            'cinema-overlay-oldMovie',
            'cinema-overlay-vhs',
            'cinema-overlay-monochrome',
            'cinema-overlay-scanlines',
            'cinema-overlay-paper',
            'cinema-overlay-vintage'
        );
        if (poster.overlay && poster.overlay !== 'none') {
            document.body.classList.add(`cinema-overlay-${poster.overlay}`);
        }

        // NOTE: Do not apply a "bootstrap" transition class here.
        // Transitions are applied per-poster in updateCinemaDisplay(media), where we have real
        // media context (and can avoid a brief "wrong" animation on first paint).

        // Set CSS variables (use rem for 4K scaling)
        root.style.setProperty('--cinema-poster-transition', `${poster.transitionDuration}s`);

        // Frame color: if ton-sur-ton mode is enabled, never apply the stored custom color
        // (it may be the UI default like #CE06FF and causes a flash before ton-sur-ton is computed).
        const needsTonSurTon = poster.frameColorMode && poster.frameColorMode !== 'custom';
        let frameColor = poster.frameColor;
        if (needsTonSurTon) {
            const variant = poster.frameColorMode === 'tonSurTonLight' ? 'light' : 'dark';
            const base =
                typeof effectiveBgColor === 'string' && /^#?[0-9a-fA-F]{6}$/.test(effectiveBgColor)
                    ? effectiveBgColor
                    : cinemaConfig.background?.solidColor;
            const safeBase =
                typeof base === 'string' && /^#?[0-9a-fA-F]{6}$/.test(base) ? base : '#000000';
            frameColor = createTonSurTonColor(safeBase, variant);
        }
        root.style.setProperty('--cinema-frame-color', frameColor);
        root.style.setProperty('--cinema-frame-width', `${poster.frameWidth / 16}rem`);

        log('Poster settings applied', poster);
    }

    // ===== Global Effects =====
    function applyGlobalEffects() {
        const root = document.documentElement;
        const effects = cinemaConfig.globalEffects;

        // Build the CSS filter string based on settings
        const filters = [];

        // Add contrast (default 100%)
        if (effects.contrast !== 100) {
            filters.push(`contrast(${effects.contrast / 100})`);
        }

        // Add brightness (default 100%)
        if (effects.brightness !== 100) {
            filters.push(`brightness(${effects.brightness / 100})`);
        }

        // Add color filter
        switch (effects.colorFilter) {
            case 'sepia':
                filters.push('sepia(0.6)');
                break;
            case 'cool':
                filters.push('hue-rotate(20deg) saturate(1.1)');
                break;
            case 'warm':
                filters.push('hue-rotate(-15deg) saturate(1.2)');
                break;
            case 'tint':
                // Tint is applied via a pseudo-element overlay, not filter
                root.style.setProperty('--cinema-tint-color', effects.tintColor);
                document.body.classList.add('cinema-tint-active');
                break;
            default:
                // 'none' - remove tint class if present
                document.body.classList.remove('cinema-tint-active');
                break;
        }

        // Remove tint class if not using tint filter
        if (effects.colorFilter !== 'tint') {
            document.body.classList.remove('cinema-tint-active');
        }

        // Apply combined filter to document
        const filterValue = filters.length > 0 ? filters.join(' ') : 'none';
        root.style.setProperty('--cinema-global-filter', filterValue);

        log('Global effects applied', effects);
    }

    // ===== Initialize Cinema Mode =====
    function initCinemaMode(config) {
        log('Initializing cinema mode', config);

        // Merge provided config with defaults
        if (config) {
            if (config.orientation) {
                cinemaConfig.orientation = config.orientation;
            }
            if (config.rotationIntervalMinutes !== undefined) {
                cinemaConfig.rotationIntervalMinutes = config.rotationIntervalMinutes;
            }
            if (config.header) {
                cinemaConfig.header = { ...cinemaConfig.header, ...config.header };
                if (config.header.typography) {
                    cinemaConfig.header.typography = {
                        ...cinemaConfig.header.typography,
                        ...config.header.typography,
                    };
                }
            }
            if (config.footer) {
                cinemaConfig.footer = { ...cinemaConfig.footer, ...config.footer };
                if (config.footer.typography) {
                    cinemaConfig.footer.typography = {
                        ...cinemaConfig.footer.typography,
                        ...config.footer.typography,
                    };
                }
            }
            if (config.ambilight) {
                cinemaConfig.ambilight = { ...cinemaConfig.ambilight, ...config.ambilight };
            }
            if (config.nowPlaying) {
                cinemaConfig.nowPlaying = { ...cinemaConfig.nowPlaying, ...config.nowPlaying };
            }
            if (config.pinnedMediaKey !== undefined) {
                cinemaConfig.pinnedMediaKey = config.pinnedMediaKey || null;
            }
            // === Merge poster settings (including nested cinematicTransitions) ===
            if (config.poster) {
                cinemaConfig.poster = { ...cinemaConfig.poster, ...config.poster };
                // Deep merge cinematicTransitions
                if (config.poster.cinematicTransitions) {
                    cinemaConfig.poster.cinematicTransitions = {
                        ...cinemaConfig.poster.cinematicTransitions,
                        ...config.poster.cinematicTransitions,
                    };
                }
            }
            // === Merge background settings ===
            if (config.background) {
                cinemaConfig.background = { ...cinemaConfig.background, ...config.background };
            }
            // === Merge metadata settings ===
            if (config.metadata) {
                cinemaConfig.metadata = { ...cinemaConfig.metadata, ...config.metadata };
                if (config.metadata.specs) {
                    cinemaConfig.metadata.specs = {
                        ...cinemaConfig.metadata.specs,
                        ...config.metadata.specs,
                    };
                }
            }
            // === Merge promotional settings ===
            if (config.promotional) {
                cinemaConfig.promotional = { ...cinemaConfig.promotional, ...config.promotional };
                if (config.promotional.qrCode) {
                    cinemaConfig.promotional.qrCode = {
                        ...cinemaConfig.promotional.qrCode,
                        ...config.promotional.qrCode,
                    };
                }
            }
            // === Merge global effects ===
            if (config.globalEffects) {
                cinemaConfig.globalEffects = {
                    ...cinemaConfig.globalEffects,
                    ...config.globalEffects,
                };
            }
        }

        // Apply cinema orientation and initial layout sizing
        applyCinemaOrientation(cinemaConfig.orientation);
        // Compute initial poster layout bands
        updatePosterLayout();

        // Apply new visual settings
        applyTypographySettings();
        applyBackgroundSettings(null); // No media yet at init
        applyPosterSettings();
        applyGlobalEffects(); // Apply global color filters

        // Create cinema UI elements
        // Skip initial header creation if ton-sur-ton is enabled - it will be created
        // in updateCinemaDisplay() with proper background colors from the poster
        // But still add the body class for layout purposes
        if (cinemaConfig.header?.enabled) {
            document.body.classList.add('cinema-header-active');
        }
        if (!cinemaConfig.header?.typography?.tonSurTon) {
            createHeader({ restartEntranceAnimation: true });
        }
        createAmbilight();

        // Always fetch media queue for fallback scenarios
        // Even when Now Playing is enabled, we need the queue for when sessions end
        const queuePromise = (async () => {
            debug('Fetching media queue');
            mediaQueue = await fetchMediaQueue();
            debug('Media queue loaded', { count: mediaQueue.length });
            if (mediaQueue.length > 0) {
                log('Media queue loaded', { count: mediaQueue.length });

                // Preload first poster for better LCP (Largest Contentful Paint)
                try {
                    const firstPoster = mediaQueue[0];
                    const posterUrl = firstPoster?.posterUrl || firstPoster?.poster_path;
                    if (posterUrl) {
                        const preloadImg = new Image();
                        preloadImg.fetchPriority = 'high';
                        preloadImg.src = posterUrl;
                    }
                } catch (_) {
                    /* optional performance optimization */
                }
            }
            return mediaQueue;
        })();

        // Pinned poster (Cinema only) overrides both rotation and Now Playing
        const pinnedKey = cinemaConfig.pinnedMediaKey;
        if (pinnedKey) {
            pinnedByConfig = true;
            isPinned = true;
            pinnedMediaId = String(pinnedKey);
            setPinnedByConfigLabel('PINNED BY CONFIG');
            showPinIndicator();
            stopNowPlaying();
            stopRotation();
            queuePromise.then(async () => {
                const pinned = await fetchPinnedMediaByKey(pinnedKey);
                if (pinned) {
                    const title = (pinned?.title || pinned?.name || '').toString().trim();
                    const year = pinned?.year ? String(pinned.year).trim() : '';
                    if (title) {
                        setPinnedByConfigLabel(`PINNED: ${title}${year ? ` (${year})` : ''}`);
                    }
                    updateCinemaDisplay(pinned);
                } else {
                    setPinnedByConfigLabel('PINNED BY CONFIG');
                    warn('Pinned key not found in playlist cache', { key: pinnedKey });
                }
            });
        }

        // Initialize Now Playing if enabled (takes priority over rotation)
        debug('Now Playing check', {
            nowPlayingEnabled: cinemaConfig.nowPlaying?.enabled,
            rotationInterval: cinemaConfig.rotationIntervalMinutes,
        });

        if (!pinnedKey && cinemaConfig.nowPlaying?.enabled) {
            debug('Starting Now Playing mode');
            startNowPlaying();
        } else {
            debug('Now Playing disabled, setting up rotation');
            log('Now Playing disabled, checking rotation', {
                rotationInterval: cinemaConfig.rotationIntervalMinutes,
                nowPlayingEnabled: cinemaConfig.nowPlaying?.enabled,
            });
            // Start rotation if enabled and Now Playing is disabled
            if (!pinnedKey && cinemaConfig.rotationIntervalMinutes > 0) {
                debug('Rotation enabled, waiting for queue');
                // Wait for queue to actually load before starting rotation
                queuePromise.then(queue => {
                    debug('Queue ready', { length: queue.length });
                    if (queue.length > 0) {
                        // Show first random poster immediately
                        debug('Showing first poster and starting rotation');
                        showNextPoster();
                        // Then start rotation timer
                        startRotation();
                    } else {
                        warn('Queue empty, cannot start rotation');
                    }
                });
            } else {
                debug('Rotation disabled (interval = 0)');
                // No rotation, but still show a random poster
                queuePromise.then(queue => {
                    if (queue.length > 0) {
                        if (!pinnedKey) showNextPoster();
                    }
                });
            }
        }

        log('Cinema mode initialized successfully');
        // Note: cinemaInitialized flag is set in showNextPoster() after first poster is displayed

        // Initialize D-pad / remote control keyboard handler
        initDpadControls();
    }

    // ===== Update Cinema Display =====
    async function updateCinemaDisplay(media) {
        const now = Date.now();
        const timeSinceLastUpdate = now - lastUpdateTime;
        updateCounter++;
        const updateId = updateCounter;

        // Get call source from stack trace
        const stackLines = new Error().stack?.split('\n') || [];
        const callSource = stackLines
            .slice(2, 5)
            .map(line => {
                const match = line.match(/at\s+(\w+)/);
                return match ? match[1] : line.trim();
            })
            .join(' → ');

        debug(`Cinema Update #${updateId} UPDATE CALLED`, {
            title: media?.title,
            key: media?.key,
            timestamp: new Date().toISOString(),
            timeSinceLastUpdateMs: timeSinceLastUpdate,
            isUpdateInProgress,
            hasPendingUpdate: !!pendingUpdate,
            cinemaInitialized,
            nowPlayingActive,
            callSource,
        });

        // Prevent concurrent updates - if an update is in progress, queue this one
        if (isUpdateInProgress) {
            debug(`Cinema Update #${updateId} QUEUED (update in progress)`, {
                queuedTitle: media?.title,
                currentlyUpdating: currentMedia?.title,
            });
            pendingUpdate = media;
            return;
        }

        // Set the lock
        isUpdateInProgress = true;
        lastUpdateTime = now;

        try {
            await performCinemaDisplayUpdate(media, updateId);
        } finally {
            // Release the lock
            isUpdateInProgress = false;

            // If there's a pending update, process it
            if (pendingUpdate) {
                const nextMedia = pendingUpdate;
                pendingUpdate = null;
                debug(`Cinema Update #${updateId} PROCESSING QUEUED UPDATE`, {
                    nextTitle: nextMedia?.title,
                    delayMs: 50,
                });
                // Use setTimeout to avoid deep call stacks
                setTimeout(() => updateCinemaDisplay(nextMedia), 50);
            }
        }
    }

    async function performCinemaDisplayUpdate(media, updateId = 0) {
        debug(`Cinema Update #${updateId} PERFORMING UPDATE`, {
            title: media?.title,
            key: media?.key,
        });

        log('Updating cinema display', media);

        // Mark initialization complete on first display update
        // This prevents bootstrap's mediaUpdated event from causing duplicate displays
        if (!cinemaInitialized) {
            cinemaInitialized = true;
            debug('First display update, initialization complete');
        }

        // Store current media for live config updates
        currentMedia = media;

        // Expose current media globally for device heartbeat system
        if (typeof window !== 'undefined' && media) {
            window.__posterramaCurrentMedia = {
                title: media.title,
                mediaId: media.key,
                type: media.type || 'movie',
                year: media.year,
                rating: media.rating || media.contentRating,
                posterUrl: media.posterUrl,
                backgroundUrl: media.backgroundUrl,
                thumbnailUrl: media.thumbnailUrl || media.posterUrl, // Fallback to posterUrl if no thumbnail
                runtime: media.runtime,
                genres: media.genres,
                overview: media.overview,
                tagline: media.tagline,
                contentRating: media.contentRating,
            };

            // Track display for KPI dashboard (fire-and-forget, don't await)
            if (media.key && media.title) {
                fetch('/api/v1/metrics/track-display', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mediaId: media.key, title: media.title }),
                }).catch(() => {
                    /* ignore tracking errors */
                });
            }
        }

        const motionUrl = media?.motionPosterUrl || media?.motionUrl || null;

        // Ensure motion poster video element is created/removed as needed
        try {
            const posterHost = document.getElementById('poster');
            if (posterHost) {
                posterHost.style.position = posterHost.style.position || 'relative';
                let videoEl = document.getElementById('poster-video');
                if (motionUrl) {
                    if (!videoEl) {
                        videoEl = document.createElement('video');
                        videoEl.id = 'poster-video';
                        videoEl.muted = true;
                        videoEl.loop = true;
                        videoEl.autoplay = true;
                        videoEl.playsInline = true;
                        videoEl.preload = 'auto';
                        videoEl.style.cssText = `
                            position: absolute;
                            inset: 0;
                            width: 100%;
                            height: 100%;
                            object-fit: contain;
                            object-position: center;
                            z-index: 1;
                            pointer-events: none;
                            background: transparent;
                        `;
                        posterHost.appendChild(videoEl);
                    }

                    if (videoEl.src !== motionUrl) {
                        videoEl.src = motionUrl;
                    }
                    const p = videoEl.play();
                    if (p && typeof p.catch === 'function') {
                        p.catch(() => {
                            /* autoplay may be blocked; muted+inline should allow */
                        });
                    }
                } else if (videoEl) {
                    try {
                        videoEl.pause();
                    } catch (_) {
                        /* ignore */
                    }
                    videoEl.remove();
                }
            }
        } catch (_) {
            /* non-fatal */
        }

        // PROGRESSIVE LOADING: Show thumbnail first, then upgrade to full quality
        const posterEl = document.getElementById('poster');
        let posterSampleUrl = null;
        if (posterEl && media && media.posterUrl) {
            const url = media.posterUrl;

            // Select transition based on configured mode and apply it
            const selectedTransition = selectTransition(media);
            const animClass = `cinema-anim-${selectedTransition}`;

            // Remove all animation classes first
            ALL_TRANSITIONS.forEach(t => document.body.classList.remove(`cinema-anim-${t}`));
            // Force reflow to restart animation
            void posterEl.offsetWidth;
            document.body.classList.add(animClass);

            debug(`Cinema Update #${updateId} TRANSITION`, {
                title: media.title,
                transition: selectedTransition,
                mode: cinemaConfig.poster?.cinematicTransitions?.selectionMode,
                timestamp: new Date().toISOString(),
            });

            log('Applied cinematic transition', {
                selectedTransition,
                mode: cinemaConfig.poster?.cinematicTransitions?.selectionMode,
            });

            // Show low-quality thumbnail immediately (skip blur when motion poster is active)
            const thumbUrl = url.includes('?')
                ? `${url}&quality=30&width=400`
                : `${url}?quality=30&width=400`;
            posterSampleUrl = thumbUrl;

            debug(`Cinema Update #${updateId} THUMBNAIL loading`, {
                url: thumbUrl,
                expectedSize: '400x600',
                title: media.title,
            });

            posterEl.style.backgroundImage = `url('${thumbUrl}')`;
            if (!motionUrl) {
                posterEl.style.filter = 'blur(3px)';
                posterEl.style.transition = 'filter 0.5s ease-out';
            } else {
                posterEl.style.filter = 'none';
            }

            // Load full quality in background
            const fullImg = new Image();
            const loadStartTime = performance.now();

            fullImg.onload = () => {
                const loadTime = Math.round(performance.now() - loadStartTime);
                posterEl.style.backgroundImage = `url('${url}')`;
                posterEl.style.filter = 'none';

                debug('ORIGINAL POSTER loaded', {
                    url: url,
                    resolution: `${fullImg.naturalWidth}x${fullImg.naturalHeight}`,
                    loadTimeMs: loadTime,
                    title: media.title,
                });

                // Set aspect ratio for framed mode
                if (fullImg.naturalWidth && fullImg.naturalHeight) {
                    document.documentElement.style.setProperty(
                        '--poster-aspect-ratio',
                        `${fullImg.naturalWidth} / ${fullImg.naturalHeight}`
                    );
                }
            };
            fullImg.onerror = err => {
                error('ORIGINAL POSTER failed to load', {
                    url: url,
                    error: err?.message || err,
                    title: media.title,
                });
                // Keep thumbnail, just remove blur
                posterEl.style.filter = 'none';
            };
            fullImg.src = url;
        }

        // Map Plex/Jellyfin/TMDB properties to cinema format
        const cinemaMedia = mapMediaToCinemaFormat(media);

        // Update background with media info (for blurred/gradient/ambient modes)
        // Must await to ensure effectiveBgColor is set before ton-sur-ton calculation
        await applyBackgroundSettings(media, { samplePosterUrl: posterSampleUrl });

        // Update header - always refresh when media changes for context-aware headers
        // Also needed if ton-sur-ton is enabled (needs effectiveBgColor from background)
        if (cinemaConfig.header?.enabled) {
            createHeader({ restartEntranceAnimation: true });
        }

        // Update footer with current media info
        createFooter(cinemaMedia);

        // Create/update promotional elements
        createQRCode(cinemaMedia);
        createRatingBadge(cinemaMedia);
        createWatchProviders(cinemaMedia);
        createAwardsBadge(cinemaMedia);
        createTrailerOverlay(cinemaMedia);

        // Update ambilight based on poster colors
        if (cinemaConfig.ambilight.enabled && media && media.dominantColor) {
            updateAmbilightColor(media.dominantColor);
        }

        // Trigger immediate heartbeat to reflect new media
        triggerLiveBeat();
    }

    // Trigger immediate heartbeat on media change
    // Simple debounce to prevent duplicate calls within 500ms
    function triggerLiveBeat() {
        try {
            const dev = window.PosterramaDevice;
            if (!dev || typeof dev.beat !== 'function') return;
            const now = Date.now();
            const until = window.__posterramaBeatCooldownUntil || 0;
            if (now < until) return;
            window.__posterramaBeatCooldownUntil = now + 500;
            dev.beat();
        } catch (_) {
            /* noop */
        }
    }

    // ===== Map Media Properties to Cinema Format =====
    function mapMediaToCinemaFormat(media) {
        if (!media) return null;

        // For Plex sessions, tech specs are already extracted by the backend
        // Check if media already has these properties (from convertSessionToMedia)
        let resolution = media.resolution || null;
        let audioCodec = media.audioCodec || null;
        let audioChannels = media.audioChannels || null;
        let aspectRatio = media.aspectRatio || null;
        const hasHDR = media.hasHDR || false;
        const hasDolbyVision = media.hasDolbyVision || false;

        // Fallback: Map resolution from Plex qualityLabel or videoStreams (for non-session media)
        if (!resolution) {
            resolution = media.qualityLabel || null;
            if (!resolution && media.videoStreams && media.videoStreams.length > 0) {
                const video = media.videoStreams[0];
                if (video.height) {
                    if (video.height >= 2160) resolution = '4K';
                    else if (video.height >= 1080) resolution = '1080p';
                    else if (video.height >= 720) resolution = '720p';
                    else resolution = 'SD';
                }
            }
        }

        // Fallback: Map audio codec from audioTracks (for non-session media)
        if (!audioCodec && media.audioTracks && media.audioTracks.length > 0) {
            const audio = media.audioTracks[0];
            audioCodec = audio.codec || audio.displayTitle || null;
            if (audioCodec) {
                // Clean up codec name (e.g. "dca" -> "DTS")
                if (
                    audioCodec.toLowerCase().includes('dca') ||
                    audioCodec.toLowerCase().includes('dts')
                ) {
                    audioCodec =
                        audio.profile && audio.profile.includes('MA') ? 'DTS-HD MA' : 'DTS';
                } else if (
                    audioCodec.toLowerCase().includes('truehd') ||
                    audioCodec.toLowerCase().includes('atmos')
                ) {
                    audioCodec = 'Dolby Atmos';
                } else if (
                    audioCodec.toLowerCase().includes('eac3') ||
                    audioCodec.toLowerCase().includes('dd+')
                ) {
                    audioCodec = 'Dolby Digital+';
                } else if (audioCodec.toLowerCase().includes('ac3')) {
                    audioCodec = 'Dolby Digital';
                } else if (audioCodec.toLowerCase().includes('aac')) {
                    audioCodec = 'AAC';
                } else if (audioCodec.toLowerCase().includes('mp3')) {
                    audioCodec = 'MP3';
                }
            }

            if (!audioChannels && audio.channels) {
                const ch = audio.channels;
                if (ch >= 8) audioChannels = '7.1';
                else if (ch >= 6) audioChannels = '5.1';
                else if (ch === 2) audioChannels = '2.0';
                else audioChannels = `${ch}.0`;
            }
        }

        // Fallback: Map aspect ratio from videoStreams (for non-session media)
        if (!aspectRatio && media.videoStreams && media.videoStreams.length > 0) {
            const video = media.videoStreams[0];
            aspectRatio = video.aspectRatio || null;

            // Convert decimal to ratio (e.g. 2.39 -> 2.39:1)
            if (aspectRatio && !aspectRatio.includes(':')) {
                aspectRatio = `${aspectRatio}:1`;
            }
        }

        return {
            ...media,
            resolution,
            audioCodec,
            audioChannels,
            aspectRatio,
            hasHDR,
            hasDolbyVision,
        };
    }

    // ===== Update Ambilight Color =====
    function updateAmbilightColor(color) {
        if (!ambilightEl) return;

        // Apply dominant color as a subtle glow
        const gradient = `radial-gradient(
            ellipse at center,
            ${color}20 0%,
            ${color}10 30%,
            transparent 60%
        )`;

        ambilightEl.style.background = gradient;

        log('Ambilight color updated', { color });
    }

    // ===== Load Cinema Configuration =====
    async function loadCinemaConfig() {
        try {
            // Use Core.fetchConfig() to include device identity headers for profile settings
            const useCore = !!(window.PosterramaCore && window.PosterramaCore.fetchConfig);
            let data;
            if (useCore) {
                data = await window.PosterramaCore.fetchConfig();
            } else {
                const response = await fetch(`/get-config?nocache=1&_t=${Date.now()}`, {
                    cache: 'no-store',
                    headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
                });
                if (!response.ok) {
                    throw new Error(`Failed to load config: ${response.status}`);
                }
                data = await response.json();
            }
            return data.cinema || {};
        } catch (err) {
            error('Failed to load cinema configuration', err);
            return {};
        }
    }

    // ===== Handle Configuration Updates =====
    async function handleConfigUpdate(newConfig) {
        log('Handling cinema config update', newConfig);

        if (newConfig.cinema) {
            // Update config
            const oldOrientation = cinemaConfig.orientation;

            if (newConfig.cinema.orientation) {
                cinemaConfig.orientation = newConfig.cinema.orientation;
            }
            if (newConfig.cinema.header) {
                cinemaConfig.header = { ...cinemaConfig.header, ...newConfig.cinema.header };
                // Deep merge typography
                if (newConfig.cinema.header.typography) {
                    cinemaConfig.header.typography = {
                        ...cinemaConfig.header.typography,
                        ...newConfig.cinema.header.typography,
                    };
                }
            }
            if (newConfig.cinema.footer) {
                cinemaConfig.footer = { ...cinemaConfig.footer, ...newConfig.cinema.footer };
                // Deep merge typography
                if (newConfig.cinema.footer.typography) {
                    cinemaConfig.footer.typography = {
                        ...cinemaConfig.footer.typography,
                        ...newConfig.cinema.footer.typography,
                    };
                }
                if (newConfig.cinema.footer.specs) {
                    cinemaConfig.footer.specs = {
                        ...cinemaConfig.footer.specs,
                        ...newConfig.cinema.footer.specs,
                    };
                }
            }
            if (newConfig.cinema.ambilight) {
                cinemaConfig.ambilight = {
                    ...cinemaConfig.ambilight,
                    ...newConfig.cinema.ambilight,
                };
            }
            if (newConfig.cinema.nowPlaying) {
                const oldNowPlaying = cinemaConfig.nowPlaying;
                cinemaConfig.nowPlaying = {
                    ...cinemaConfig.nowPlaying,
                    ...newConfig.cinema.nowPlaying,
                };

                // If Now Playing settings changed, restart
                const enabledChanged =
                    oldNowPlaying?.enabled !== newConfig.cinema.nowPlaying.enabled;
                const intervalChanged =
                    oldNowPlaying?.updateIntervalSeconds !==
                    newConfig.cinema.nowPlaying.updateIntervalSeconds;

                if (enabledChanged || intervalChanged) {
                    log('Now Playing config changed, restarting', {
                        enabled: newConfig.cinema.nowPlaying.enabled,
                        interval: newConfig.cinema.nowPlaying.updateIntervalSeconds,
                    });

                    // Stop both Now Playing and rotation
                    stopNowPlaying();
                    stopRotation();

                    // Start appropriate mode
                    const pinnedKeyNext =
                        newConfig.cinema.pinnedMediaKey !== undefined
                            ? newConfig.cinema.pinnedMediaKey
                            : cinemaConfig.pinnedMediaKey;
                    if (pinnedKeyNext) {
                        log('Skipping mode restart due to pinned poster', { key: pinnedKeyNext });
                    } else if (newConfig.cinema.nowPlaying.enabled) {
                        startNowPlaying();
                    } else if (cinemaConfig.rotationIntervalMinutes > 0) {
                        startRotation();
                    }
                }
            }

            // Pinned poster (Cinema only)
            if (newConfig.cinema.pinnedMediaKey !== undefined) {
                const oldPinned = cinemaConfig.pinnedMediaKey || null;
                cinemaConfig.pinnedMediaKey = newConfig.cinema.pinnedMediaKey || null;

                const changed =
                    String(oldPinned || '') !== String(cinemaConfig.pinnedMediaKey || '');
                if (changed) {
                    if (cinemaConfig.pinnedMediaKey) {
                        pinnedByConfig = true;
                        isPinned = true;
                        pinnedMediaId = String(cinemaConfig.pinnedMediaKey);
                        setPinnedByConfigLabel('PINNED BY CONFIG');
                        showPinIndicator();
                        stopNowPlaying();
                        stopRotation();
                        const pinned = await fetchPinnedMediaByKey(cinemaConfig.pinnedMediaKey);
                        if (pinned) {
                            const title = (pinned?.title || pinned?.name || '').toString().trim();
                            const year = pinned?.year ? String(pinned.year).trim() : '';
                            if (title) {
                                setPinnedByConfigLabel(
                                    `PINNED: ${title}${year ? ` (${year})` : ''}`
                                );
                            }
                            updateCinemaDisplay(pinned);
                        } else {
                            setPinnedByConfigLabel('PINNED BY CONFIG');
                        }
                    } else {
                        pinnedByConfig = false;
                        isPinned = false;
                        pinnedMediaId = null;
                        setPinnedByConfigLabel('');
                        hidePinIndicator();
                        if (cinemaConfig.nowPlaying?.enabled) {
                            startNowPlaying();
                        } else if (cinemaConfig.rotationIntervalMinutes > 0) {
                            showNextPoster();
                            startRotation();
                        } else {
                            showNextPoster();
                        }
                    }
                }
            }
            if (newConfig.cinema.rotationIntervalMinutes !== undefined) {
                const oldInterval = cinemaConfig.rotationIntervalMinutes;
                cinemaConfig.rotationIntervalMinutes = newConfig.cinema.rotationIntervalMinutes;

                // If rotation interval changed and Now Playing is disabled, restart rotation
                if (
                    oldInterval !== newConfig.cinema.rotationIntervalMinutes &&
                    !cinemaConfig.nowPlaying?.enabled
                ) {
                    log('Rotation interval changed, restarting rotation', {
                        old: oldInterval,
                        new: newConfig.cinema.rotationIntervalMinutes,
                    });
                    if (!cinemaConfig.pinnedMediaKey) startRotation();
                }
            }

            // Apply orientation if changed
            if (newConfig.cinema.orientation && newConfig.cinema.orientation !== oldOrientation) {
                log('Orientation changed, applying', { orientation: newConfig.cinema.orientation });
                applyCinemaOrientation(newConfig.cinema.orientation);
                updatePosterLayout();
            }

            // Recreate header if header settings changed
            if (newConfig.cinema.header) {
                createHeader();
            }

            // Recreate footer if footer settings changed
            if (newConfig.cinema.footer && currentMedia) {
                const cinemaMedia = mapMediaToCinemaFormat(currentMedia);
                createFooter(cinemaMedia);
            }

            // Update ambilight if ambilight settings changed
            if (newConfig.cinema.ambilight) {
                createAmbilight();
                if (currentMedia && currentMedia.dominantColor) {
                    updateAmbilightColor(currentMedia.dominantColor);
                }
            }

            // Update poster settings (including nested cinematicTransitions)
            if (newConfig.cinema.poster) {
                cinemaConfig.poster = { ...cinemaConfig.poster, ...newConfig.cinema.poster };
                // Deep merge cinematicTransitions
                if (newConfig.cinema.poster.cinematicTransitions) {
                    cinemaConfig.poster.cinematicTransitions = {
                        ...cinemaConfig.poster.cinematicTransitions,
                        ...newConfig.cinema.poster.cinematicTransitions,
                    };
                    log('Cinematic transitions updated', cinemaConfig.poster.cinematicTransitions);
                }
                applyPosterSettings();
            }

            // Update background settings
            if (newConfig.cinema.background) {
                cinemaConfig.background = {
                    ...cinemaConfig.background,
                    ...newConfig.cinema.background,
                };
                await applyBackgroundSettings(currentMedia);
                // Update header/footer if ton-sur-ton is enabled (depends on effectiveBgColor)
                if (cinemaConfig.header?.typography?.tonSurTon) {
                    createHeader();
                }
                if (cinemaConfig.footer?.typography?.tonSurTon && currentMedia) {
                    const cinemaMedia = mapMediaToCinemaFormat(currentMedia);
                    createFooter(cinemaMedia);
                }
            }

            // Update metadata settings
            if (newConfig.cinema.metadata) {
                cinemaConfig.metadata = { ...cinemaConfig.metadata, ...newConfig.cinema.metadata };
                // Deep merge specs
                if (newConfig.cinema.metadata.specs) {
                    cinemaConfig.metadata.specs = {
                        ...cinemaConfig.metadata.specs,
                        ...newConfig.cinema.metadata.specs,
                    };
                }
                applyTypographySettings();
                // Recreate footer to reflect metadata changes
                if (currentMedia) {
                    const cinemaMedia = mapMediaToCinemaFormat(currentMedia);
                    createFooter(cinemaMedia);
                }
            }

            // Update promotional settings
            if (newConfig.cinema.promotional) {
                cinemaConfig.promotional = {
                    ...cinemaConfig.promotional,
                    ...newConfig.cinema.promotional,
                };
                // Deep merge qrCode
                if (newConfig.cinema.promotional.qrCode) {
                    cinemaConfig.promotional.qrCode = {
                        ...cinemaConfig.promotional.qrCode,
                        ...newConfig.cinema.promotional.qrCode,
                    };
                }
                // Create/update promotional elements
                if (currentMedia) {
                    const cinemaMedia = mapMediaToCinemaFormat(currentMedia);
                    createQRCode(cinemaMedia);
                    createRatingBadge(cinemaMedia);
                    createWatchProviders(cinemaMedia);
                    createAwardsBadge(cinemaMedia);
                    createTrailerOverlay(cinemaMedia);
                }
            }

            // Update global effects
            if (newConfig.cinema.globalEffects) {
                cinemaConfig.globalEffects = {
                    ...cinemaConfig.globalEffects,
                    ...newConfig.cinema.globalEffects,
                };
                applyGlobalEffects();
            }

            // Update timeline border in preview mode
            if (newConfig.cinema.nowPlaying?.timelineBorder !== undefined) {
                updateTimelineBorderPreview(newConfig.cinema.nowPlaying.timelineBorder);
            }
        }
    }

    /**
     * Update timeline border for preview mode
     * Shows a demo border at 35% progress to preview the settings
     * @param {object} config - Timeline border configuration
     */
    function updateTimelineBorderPreview(config) {
        // Check if we're in preview mode
        const isPreview =
            window.self !== window.top ||
            window.location.search.includes('preview=') ||
            window.Core?.isPreviewMode?.();

        // Outside preview mode, never show demo progress. Timeline border is only allowed
        // to be visible during active Now Playing playback.
        if (!isPreview) {
            if (!config?.enabled || !cinemaConfig.nowPlaying?.enabled) {
                if (window.PosterramaTimelineBorder) {
                    window.PosterramaTimelineBorder.destroy();
                }
                return;
            }

            // Apply config (kept hidden until nowPlayingActive becomes true)
            initTimelineBorder(config);
            if (window.PosterramaTimelineBorder && !nowPlayingActive) {
                window.PosterramaTimelineBorder.hide();
            }
            return;
        }

        if (!config?.enabled) {
            // Disabled - destroy if exists
            if (window.PosterramaTimelineBorder) {
                window.PosterramaTimelineBorder.destroy();
            }
            return;
        }

        // Load and initialize timeline border with demo progress
        if (!window.PosterramaTimelineBorder) {
            const script = document.createElement('script');
            script.src = '/cinema/timeline-border.js?v=' + Date.now();
            script.async = true;
            script.onload = () => {
                if (window.PosterramaTimelineBorder) {
                    window.PosterramaTimelineBorder.init(config);
                    // Set demo progress at 35% for preview
                    window.PosterramaTimelineBorder.setProgress(35);
                    window.PosterramaTimelineBorder.show();
                    log('Timeline border preview initialized at 35%');
                }
            };
            script.onerror = () => {
                warn('Failed to load timeline border module');
            };
            document.head.appendChild(script);
        } else {
            // Already loaded - reinitialize with new config
            window.PosterramaTimelineBorder.init(config);
            // Set demo progress at 35% for preview
            window.PosterramaTimelineBorder.setProgress(35);
            window.PosterramaTimelineBorder.show();
            log('Timeline border preview updated at 35%');
        }
    }

    // ===== Pause Indicator =====
    let pauseIndicatorEl = null;
    let pinIndicatorEl = null;
    let pinnedByConfigLabel = ''; // Cached label shown in pin indicator

    function createPinIndicator() {
        if (pinIndicatorEl) return;

        pinIndicatorEl = document.createElement('div');
        pinIndicatorEl.className = 'cinema-pin-indicator';
        pinIndicatorEl.setAttribute('role', 'status');
        pinIndicatorEl.innerHTML = `
            <span class="pin-icon" aria-hidden="true">
                <svg class="pin-svg" viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                    <path d="M12 22s8-4.5 8-11a8 8 0 10-16 0c0 6.5 8 11 8 11z"></path>
                    <circle cx="12" cy="11" r="3"></circle>
                </svg>
            </span>
        `;
        document.body.appendChild(pinIndicatorEl);
        setPinnedByConfigLabel(pinnedByConfigLabel);
    }

    function setPinnedByConfigLabel(label) {
        pinnedByConfigLabel = (label || '').toString().trim();
        if (pinIndicatorEl) {
            const a11yLabel = pinnedByConfigLabel || 'Pinned';
            pinIndicatorEl.setAttribute('aria-label', a11yLabel);
            pinIndicatorEl.setAttribute('title', a11yLabel);
        }
    }

    function showPinIndicator() {
        if (!pinnedByConfig) return;
        if (!pinIndicatorEl) createPinIndicator();
        pinIndicatorEl.classList.add('visible');
    }

    function hidePinIndicator() {
        if (pinIndicatorEl) {
            pinIndicatorEl.classList.remove('visible');
        }
    }

    function createPauseIndicator() {
        if (pauseIndicatorEl) return;

        pauseIndicatorEl = document.createElement('div');
        pauseIndicatorEl.className = 'cinema-pause-indicator';
        pauseIndicatorEl.innerHTML = `
            <div class="pause-icon">
                <span class="pause-bar"></span>
                <span class="pause-bar"></span>
            </div>
            <span class="pause-text">PAUSED</span>
        `;
        document.body.appendChild(pauseIndicatorEl);
    }

    function showPauseIndicator() {
        // Check if pause indicator is enabled in config (default: true)
        const cfg = window.appConfig || window.__serverConfig;
        if (cfg?.pauseIndicator?.enabled === false) return;
        if (!pauseIndicatorEl) createPauseIndicator();
        pauseIndicatorEl.classList.add('visible');
    }

    function hidePauseIndicator() {
        if (pauseIndicatorEl) {
            pauseIndicatorEl.classList.remove('visible');
        }
    }

    // ===== Playback Control API =====
    window.__posterramaPlayback = {
        resume: () => {
            try {
                if (!pinnedByConfig) {
                    isPinned = false;
                    pinnedMediaId = null;
                } else {
                    // Keep config pin intact
                    isPinned = true;
                    showPinIndicator();
                }
                window.__posterramaPaused = false;
                hidePauseIndicator();

                log(
                    pinnedByConfig
                        ? 'Resume: pinned by config (no unpin)'
                        : 'Poster unpinned, rotation resumed'
                );

                // Trigger heartbeat to update admin UI
                try {
                    const dev = window.PosterramaDevice;
                    if (dev && typeof dev.beat === 'function') {
                        dev.beat();
                    }
                } catch (_) {
                    /* ignore heartbeat */
                }
            } catch (e) {
                error('Failed to resume rotation', e);
            }
        },
        pause: () => {
            try {
                window.__posterramaPaused = true;
                showPauseIndicator();
                log('Playback paused');
            } catch (_) {
                /* ignore */
            }
        },
        next: () => {
            try {
                if (pinnedByConfig) {
                    // Ignore next/prev while pinned via device override
                    window.__posterramaPaused = false;
                    hidePauseIndicator();
                    showPinIndicator();
                    log('Next ignored: poster is pinned by config');
                } else {
                    isPinned = false;
                    pinnedMediaId = null;
                    window.__posterramaPaused = false;
                    hidePauseIndicator();
                    showNextPoster();
                }
                // Trigger heartbeat to update admin UI
                try {
                    const dev = window.PosterramaDevice;
                    if (dev && typeof dev.beat === 'function') {
                        dev.beat();
                    }
                } catch (_) {
                    /* ignore heartbeat */
                }
            } catch (e) {
                error('Failed to show next poster', e);
            }
        },
        prev: () => {
            try {
                if (pinnedByConfig) {
                    window.__posterramaPaused = false;
                    hidePauseIndicator();
                    showPinIndicator();
                    log('Prev ignored: poster is pinned by config');
                } else {
                    isPinned = false;
                    pinnedMediaId = null;
                    window.__posterramaPaused = false;
                    hidePauseIndicator();
                    showPreviousPoster();
                }
                // Trigger heartbeat to update admin UI
                try {
                    const dev = window.PosterramaDevice;
                    if (dev && typeof dev.beat === 'function') {
                        dev.beat();
                    }
                } catch (_) {
                    /* ignore heartbeat */
                }
            } catch (e) {
                error('Failed to show previous poster', e);
            }
        },
        remoteKey: key => {
            try {
                switch (key) {
                    case 'left':
                        window.__posterramaPlayback.prev();
                        break;
                    case 'right':
                        window.__posterramaPlayback.next();
                        break;
                }
            } catch (e) {
                error('Failed to handle remote key', e);
            }
        },
    };

    // ===== D-pad / Remote Control Keyboard Handler =====
    function togglePause() {
        if (window.__posterramaPaused) {
            window.__posterramaPlayback.resume();
        } else {
            window.__posterramaPlayback.pause();
        }
    }

    function initDpadControls() {
        document.addEventListener('keydown', e => {
            // Ignore if in input field
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            switch (e.key) {
                case 'ArrowRight':
                    e.preventDefault();
                    window.__posterramaPlayback.next();
                    log('D-pad: Next poster');
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    window.__posterramaPlayback.prev();
                    log('D-pad: Previous poster');
                    break;
                case ' ': // Spacebar
                case 'Enter':
                case 'MediaPlayPause':
                    e.preventDefault();
                    togglePause();
                    break;
                case 'MediaPause':
                    e.preventDefault();
                    if (!window.__posterramaPaused) {
                        window.__posterramaPlayback.pause();
                    }
                    break;
                case 'MediaPlay':
                    e.preventDefault();
                    if (window.__posterramaPaused) {
                        window.__posterramaPlayback.resume();
                    }
                    break;
            }
        });

        log('D-pad controls initialized');
    }

    // ===== Poster Rotation Functions =====
    let currentMediaIndex = -1; // Start at -1, will be randomized on first showNextPoster()
    let currentSessionIndex = 0; // For multi-stream Now Playing rotation
    let nowPlayingSessions = []; // Store all active sessions for rotation
    let isFirstPoster = true; // Track if this is the first poster display

    function startRotation() {
        try {
            // Don't start rotation if Now Playing is active with a session
            if (nowPlayingActive) {
                log('Rotation blocked: Now Playing is active');
                return;
            }

            // Clear existing timer
            if (rotationTimer) {
                clearInterval(rotationTimer);
                rotationTimer = null;
            }

            const intervalMinutes = cinemaConfig.rotationIntervalMinutes || 0;

            // If interval is 0, rotation is disabled
            if (intervalMinutes <= 0) {
                log('Rotation disabled (interval = 0)');
                return;
            }

            const intervalMs = intervalMinutes * 60 * 1000;
            log('Starting poster rotation', { intervalMinutes, intervalMs });

            rotationTimer = setInterval(() => {
                if (!isPinned && !nowPlayingActive) {
                    debug('ROTATION TIMER TICK', {
                        intervalMs,
                        timestamp: new Date().toISOString(),
                    });
                    showNextPoster();
                }
            }, intervalMs);
        } catch (e) {
            error('Failed to start rotation', e);
        }
    }

    function stopRotation() {
        if (rotationTimer) {
            clearInterval(rotationTimer);
            rotationTimer = null;
            log('Rotation stopped');
        }
    }

    async function fetchMediaQueue() {
        try {
            // Wait for config to be available
            let cfg = window.appConfig || window.__serverConfig;
            if (!cfg) {
                // Wait a bit for config to load
                await new Promise(resolve => setTimeout(resolve, 200));
                cfg = window.appConfig || window.__serverConfig || {};
            }
            const type = (cfg && cfg.type) || 'movies';

            // Check if games mode is active
            const wallartMode = cfg?.wallartMode || {};
            const isGamesOnly = wallartMode.gamesOnly === true;

            // Build URL with appropriate parameter
            let url = `/get-media?count=50&type=${encodeURIComponent(type)}&mode=cinema`;
            if (isGamesOnly) {
                url += '&gamesOnly=true';
            } else {
                url += '&excludeGames=1';
            }

            // Preview must be “fresh” to avoid showing stale selections from cached responses.
            if (IS_PREVIEW_MODE) {
                url += `&nocache=true&cb=${Date.now()}`;
            }

            debug('Fetching media', { url });
            const res = await fetch(url, {
                cache: IS_PREVIEW_MODE ? 'no-store' : 'no-cache',
                headers: {
                    'Cache-Control': IS_PREVIEW_MODE ? 'no-store' : 'no-cache',
                    Pragma: 'no-cache',
                },
            });
            if (!res.ok) {
                error('Media fetch failed', { status: res.status, statusText: res.statusText });
                return [];
            }
            const data = await res.json();
            const items = Array.isArray(data)
                ? data
                : Array.isArray(data?.results)
                  ? data.results
                  : [];

            debug('Media fetch result', { count: items.length });

            // Shuffle the queue for random order on each page load
            // Fisher-Yates shuffle algorithm
            for (let i = items.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [items[i], items[j]] = [items[j], items[i]];
            }

            log('Fetched media queue', {
                count: items.length,
                shuffled: true,
                firstTitle: items[0]?.title,
            });
            return items;
        } catch (e) {
            error('Failed to fetch media queue', e);
            return [];
        }
    }

    function showNextPoster() {
        try {
            if (pinnedByConfig) {
                log('Rotation skipped: poster is pinned by config');
                return;
            }
            // Don't rotate if Now Playing is active
            if (nowPlayingActive) {
                log('Rotation skipped: Now Playing is active');
                return;
            }

            if (mediaQueue.length === 0) {
                log('No media in queue for rotation');
                return;
            }

            // Randomize starting position on first poster
            if (isFirstPoster) {
                currentMediaIndex = Math.floor(Math.random() * mediaQueue.length);
                isFirstPoster = false;
                log('First poster - randomized start index', { index: currentMediaIndex });
            } else {
                currentMediaIndex = (currentMediaIndex + 1) % mediaQueue.length;
            }
            const nextMedia = mediaQueue[currentMediaIndex];

            debug('showNextPoster called', {
                index: currentMediaIndex,
                title: nextMedia?.title,
                queueLength: mediaQueue.length,
                timestamp: new Date().toISOString(),
            });

            log('Showing next poster', { index: currentMediaIndex, title: nextMedia?.title });
            updateCinemaDisplay(nextMedia);
            // Note: Don't dispatch mediaUpdated here - updateCinemaDisplay already handles the update
            // Dispatching it would cause double updates
        } catch (e) {
            error('Failed to show next poster', e);
        }
    }

    function showPreviousPoster() {
        try {
            if (pinnedByConfig) {
                log('Rotation skipped: poster is pinned by config');
                return;
            }
            if (mediaQueue.length === 0) {
                log('No media in queue for rotation');
                return;
            }

            currentMediaIndex = (currentMediaIndex - 1 + mediaQueue.length) % mediaQueue.length;
            const prevMedia = mediaQueue[currentMediaIndex];

            debug('showPreviousPoster called', {
                index: currentMediaIndex,
                title: prevMedia?.title,
                queueLength: mediaQueue.length,
                timestamp: new Date().toISOString(),
            });

            log('Showing previous poster', { index: currentMediaIndex, title: prevMedia?.title });
            updateCinemaDisplay(prevMedia);
            // Note: Don't dispatch mediaUpdated here - updateCinemaDisplay already handles the update
        } catch (e) {
            error('Failed to show previous poster', e);
        }
    }

    // ===== Now Playing Integration =====
    // Avoid spamming the browser console with repeated 401s when the Sessions APIs are protected.
    // If a sessions endpoint returns 401, temporarily disable polling.
    const nowPlayingBackoff = {
        plexDisabledUntil: 0,
        jellyfinDisabledUntil: 0,
        warnedPlex: false,
        warnedJellyfin: false,
    };

    async function initNowPlayingDeviceData() {
        try {
            const deviceState = window.PosterramaDevice?.getState?.();
            if (!deviceState?.deviceId) return;

            // Device details endpoint is admin-only; use the public preview endpoint for display clients.
            const res = await fetch(`/api/devices/${deviceState.deviceId}/preview`, {
                credentials: 'include',
                headers: { 'Cache-Control': 'no-cache' },
            });
            if (!res.ok) return;

            const data = await res.json();
            window.__devicePlexUsername = data?.plexUsername || null;
            log('Loaded device Plex username', { username: window.__devicePlexUsername });
        } catch (e) {
            error('Failed to load device Plex username', e);
        }
    }

    async function fetchPlexSessions() {
        try {
            if (Date.now() < nowPlayingBackoff.plexDisabledUntil) return [];
            const res = await fetch('/api/plex/sessions', {
                cache: 'no-cache',
                headers: { 'Cache-Control': 'no-cache' },
                credentials: 'include',
            });
            if (res.status === 401) {
                // Disable for 10 minutes to avoid noisy console spam on display clients.
                nowPlayingBackoff.plexDisabledUntil = Date.now() + 10 * 60 * 1000;
                if (!nowPlayingBackoff.warnedPlex) {
                    nowPlayingBackoff.warnedPlex = true;
                    log('Plex sessions unauthorized; disabling Now Playing polling for 10 minutes');
                }
                return [];
            }
            if (!res.ok) return [];
            const data = await res.json();

            // Cache server name for image proxy URLs
            if (data?.serverName) {
                window.__plexServerName = data.serverName;
            }

            // Mark sessions with source
            const sessions = data?.sessions || [];
            return sessions.map(s => ({ ...s, _source: 'plex' }));
        } catch (e) {
            error('Failed to fetch Plex sessions', e);
            return [];
        }
    }

    async function fetchJellyfinSessions() {
        try {
            if (Date.now() < nowPlayingBackoff.jellyfinDisabledUntil) return [];
            const res = await fetch('/api/jellyfin/sessions', {
                cache: 'no-cache',
                headers: { 'Cache-Control': 'no-cache' },
                credentials: 'include',
            });
            if (res.status === 401) {
                nowPlayingBackoff.jellyfinDisabledUntil = Date.now() + 10 * 60 * 1000;
                if (!nowPlayingBackoff.warnedJellyfin) {
                    nowPlayingBackoff.warnedJellyfin = true;
                    log(
                        'Jellyfin / Emby sessions unauthorized; disabling Now Playing polling for 10 minutes'
                    );
                }
                return [];
            }
            if (!res.ok) return [];
            const data = await res.json();

            // Cache server name for image proxy URLs
            if (data?.serverName) {
                window.__jellyfinServerName = data.serverName;
            }

            // Sessions are already marked with _source: 'jellyfin' by the poller
            return data?.sessions || [];
        } catch (e) {
            error('Failed to fetch Jellyfin / Emby sessions', e);
            return [];
        }
    }

    /**
     * Fetch sessions from all enabled media servers
     * @returns {Promise<Array>} Combined sessions from Plex and Jellyfin
     */
    async function fetchAllSessions() {
        // Fetch from both sources in parallel
        const [plexSessions, jellyfinSessions] = await Promise.all([
            fetchPlexSessions(),
            fetchJellyfinSessions(),
        ]);

        // Combine sessions
        const allSessions = [...plexSessions, ...jellyfinSessions];

        log('Fetched all sessions', {
            plex: plexSessions.length,
            jellyfin: jellyfinSessions.length,
            total: allSessions.length,
        });

        return allSessions;
    }

    function getDevicePlexUsername() {
        try {
            // Return cached value if available
            if (window.__devicePlexUsername !== undefined) {
                return window.__devicePlexUsername;
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    function selectSession(sessions) {
        if (!sessions || sessions.length === 0) return null;

        const priority = cinemaConfig.nowPlaying?.priority || 'first';
        const filterUser = cinemaConfig.nowPlaying?.filterUser || '';
        const deviceUsername = getDevicePlexUsername();

        function pickByPriority(list) {
            if (!list || list.length === 0) return null;
            if (priority === 'random') return list[Math.floor(Math.random() * list.length)];
            return list[0];
        }

        function selectSessionFrom(list) {
            if (!list || list.length === 0) return null;

            // Priority 1: If priority is 'user' and filterUser is set, filter by that username
            if (priority === 'user' && filterUser) {
                const userSessions = list.filter(s => s.username === filterUser);
                if (userSessions.length > 0) {
                    log('Filtered sessions by configured filterUser', {
                        username: filterUser,
                        count: userSessions.length,
                    });
                    return userSessions[0];
                }
                log('No sessions found for filterUser', { username: filterUser });
                return null;
            }

            // Priority 2: If device has plexUsername configured, filter by that username
            let filtered = list;
            if (deviceUsername) {
                const userSessions = filtered.filter(s => s.username === deviceUsername);
                if (userSessions.length > 0) {
                    filtered = userSessions;
                    log('Filtered sessions by device username', {
                        username: deviceUsername,
                        count: filtered.length,
                    });
                }
            }

            return pickByPriority(filtered);
        }

        const sourcePref = String(cinemaConfig.nowPlaying?.sourcePreference || 'auto');
        if (sourcePref === 'plex' || sourcePref === 'jellyfin') {
            const preferred = sessions.filter(s => s._source === sourcePref);
            const fallback = sessions.filter(s => s._source !== sourcePref);
            return selectSessionFrom(preferred) || selectSessionFrom(fallback);
        }

        return selectSessionFrom(sessions);
    }

    async function fetchPinnedMediaByKey(key) {
        try {
            const url = `/api/media/lookup?key=${encodeURIComponent(String(key || ''))}`;
            const res = await fetch(url, {
                cache: 'no-cache',
                headers: { 'Cache-Control': 'no-cache' },
                credentials: 'include',
            });
            if (!res.ok) return null;
            const data = await res.json();
            return data?.result || null;
        } catch (_) {
            return null;
        }
    }

    function convertSessionToMedia(session) {
        try {
            // Debug: log full session data to see what's available
            debug('Raw Plex session data', session);

            // Determine which thumb to use (movie vs episode)
            let thumbPath = session.thumb;
            if (session.type === 'episode' && session.grandparentThumb) {
                // For TV episodes, prefer show poster
                thumbPath = session.grandparentThumb;
            }

            // Build display title
            let displayTitle = session.title || 'Unknown';
            if (session.type === 'episode') {
                if (session.grandparentTitle) {
                    displayTitle = session.grandparentTitle; // Show name
                }
                if (session.parentTitle && session.title) {
                    displayTitle += ` - ${session.parentTitle}`; // Season
                }
            }

            // Convert Plex thumb URL to use our image proxy
            // Use dynamic server name from API (cached in window.__plexServerName)
            const serverName = window.__plexServerName || 'Plex Server';
            const posterUrl = thumbPath
                ? `/image?server=${encodeURIComponent(serverName)}&path=${encodeURIComponent(thumbPath)}`
                : null;
            const backdropUrl = session.art
                ? `/image?server=${encodeURIComponent(serverName)}&path=${encodeURIComponent(session.art)}`
                : null;

            // Extract video resolution from Media array if available
            const mediaInfo = session.Media?.[0];
            const videoResolution =
                session.videoResolution || mediaInfo?.videoResolution || session.resolution || null;
            const width = mediaInfo?.width || session.width || null;

            return {
                id: session.ratingKey || session.key || `session-${Date.now()}`,
                key: `plex-session-${session.ratingKey || session.key}`,
                title: displayTitle,
                year: session.year || null,
                rating: session.contentRating || null,
                overview: session.summary || null,
                tagline: session.tagline || null,
                posterUrl: posterUrl,
                backgroundUrl: backdropUrl,
                thumbnailUrl: posterUrl,
                genres: session.genres || [],
                runtime: session.duration ? Math.round(session.duration / 60000) : null,
                type: session.type === 'episode' ? 'tv' : 'movie',
                source: 'plex-session',
                // Technical specs from session
                resolution: session.resolution || null,
                videoResolution: videoResolution,
                width: width,
                videoCodec: session.videoCodec || mediaInfo?.videoCodec || null,
                audioCodec: session.audioCodec || mediaInfo?.audioCodec || null,
                audioChannels: session.audioChannels || mediaInfo?.audioChannels || null,
                aspectRatio: session.aspectRatio || mediaInfo?.aspectRatio || null,
                hasHDR: session.hasHDR || false,
                hasDolbyVision: session.hasDolbyVision || false,
                // Context-aware header fields
                // Plex addedAt is Unix timestamp in seconds, convert to ISO string
                addedAt: session.addedAt ? new Date(session.addedAt * 1000).toISOString() : null,
                originallyAvailableAt: session.originallyAvailableAt || null,
                releaseDate: session.originallyAvailableAt || null,
                audienceRating: session.audienceRating || null,
                // Plex rating is 0-10 scale, audienceRating might be percentage
                rottenTomatoesScore:
                    session.audienceRating ||
                    (session.rating ? Math.round(session.rating * 10) : null),
                // Keep reference to original session for debugging
                _rawSession: session,
            };
        } catch (e) {
            error('Failed to convert session to media', e);
            return null;
        }
    }

    // Track if initial Now Playing check has been done
    let initialNowPlayingCheckDone = false;

    async function checkNowPlaying() {
        try {
            const nowPlayingConfig = cinemaConfig.nowPlaying;
            if (!nowPlayingConfig?.enabled) return;

            // Fetch sessions from all media servers (Plex + Jellyfin)
            const sessions = await fetchAllSessions();

            // Filter sessions based on config (user filter, device username)
            const filteredSessions = filterSessions(sessions);

            debug('checkNowPlaying', {
                sessionCount: filteredSessions?.length || 0,
                nowPlayingActive,
                initialCheckDone: initialNowPlayingCheckDone,
            });

            if (filteredSessions && filteredSessions.length > 0) {
                // Stop poster rotation when we have active sessions
                if (!nowPlayingActive) {
                    stopRotation();
                    // Show timeline border when Now Playing becomes active
                    if (window.PosterramaTimelineBorder) {
                        window.PosterramaTimelineBorder.show();
                    }
                }

                nowPlayingActive = true;
                nowPlayingSessions = filteredSessions;

                // Multi-stream rotation: use rotationIntervalMinutes to cycle through sessions
                const intervalMinutes = cinemaConfig.rotationIntervalMinutes || 0;

                if (filteredSessions.length > 1 && intervalMinutes > 0) {
                    // Multiple streams - rotation will be handled by startNowPlayingRotation
                    if (!nowPlayingRotationTimer) {
                        // Show first session immediately
                        currentSessionIndex = 0;
                        const media = convertSessionToMedia(filteredSessions[0]);
                        if (media) {
                            log('NOW PLAYING: First multi-stream session', {
                                source: 'checkNowPlaying (multi-stream first)',
                                title: media.title,
                                sessionCount: filteredSessions.length,
                                timestamp: new Date().toISOString(),
                            });
                            updateCinemaDisplay(media);
                            lastSessionId =
                                filteredSessions[0].ratingKey || filteredSessions[0].key;
                        }
                        // Update timeline border with first session
                        updateTimelineBorderProgress(filteredSessions[0]);
                        startNowPlayingRotation();
                    } else {
                        // Update timeline border with current session in rotation
                        const currentSession =
                            filteredSessions[currentSessionIndex] || filteredSessions[0];
                        updateTimelineBorderProgress(currentSession);
                    }
                } else {
                    // Single stream or no rotation - show first/selected session
                    const selectedSession = selectSession(filteredSessions);
                    const sessionId = selectedSession.ratingKey || selectedSession.key;

                    // Update timeline border with current session progress
                    updateTimelineBorderProgress(selectedSession);

                    // Only update if session changed
                    if (sessionId !== lastSessionId) {
                        log('New active session detected', {
                            sessionId,
                            title: selectedSession.title,
                        });
                        lastSessionId = sessionId;

                        const media = convertSessionToMedia(selectedSession);
                        if (media) {
                            log('NOW PLAYING: Session changed', {
                                source: 'checkNowPlaying (session changed)',
                                title: media.title,
                                sessionId,
                                timestamp: new Date().toISOString(),
                            });
                            updateCinemaDisplay(media);
                        }
                    }
                }
            } else {
                // No active sessions
                const wasActive = nowPlayingActive;
                const isFirstCheck = !initialNowPlayingCheckDone;

                lastSessionId = null;
                nowPlayingActive = false;
                nowPlayingSessions = [];
                stopNowPlayingRotation();

                // Hide timeline border when no active session
                if (window.PosterramaTimelineBorder) {
                    window.PosterramaTimelineBorder.hide();
                }

                // Apply fallback behavior if:
                // 1. Was previously showing Now Playing and sessions ended, OR
                // 2. This is the first check and there are no sessions (initial fallback)
                if ((wasActive || isFirstCheck) && nowPlayingConfig.fallbackToRotation !== false) {
                    log('FALLBACK TO ROTATION', {
                        source: 'checkNowPlaying fallback',
                        wasActive,
                        isFirstCheck,
                        fallbackToRotation: nowPlayingConfig.fallbackToRotation,
                        queueLength: mediaQueue.length,
                        timestamp: new Date().toISOString(),
                    });
                    log('No active sessions, applying fallback behavior');

                    // Wait for media queue if this is the first check and queue is empty
                    if (isFirstCheck && mediaQueue.length === 0) {
                        debug('Waiting for media queue to load...');
                        // Poll for queue to be loaded (max 5 seconds)
                        for (let i = 0; i < 50 && mediaQueue.length === 0; i++) {
                            await new Promise(resolve => setTimeout(resolve, 100));
                        }
                        debug('Queue after waiting', { queueLength: mediaQueue.length });
                    }

                    // If still empty, try fetching again with increasing delays
                    if (mediaQueue.length === 0) {
                        debug('Queue still empty, retrying fetch...');
                        // Retry up to 7 times with increasing delays (1s, 2s, 3s, etc.)
                        for (let retry = 1; retry <= 7 && mediaQueue.length === 0; retry++) {
                            await new Promise(resolve => setTimeout(resolve, 100));
                            debug('Retrying queue fetch', { retry, maxRetries: 7 });
                            mediaQueue = await fetchMediaQueue();
                            debug('Retry fetch result', { queueLength: mediaQueue.length });
                        }
                    }

                    // Return to rotation mode
                    if (mediaQueue.length > 0) {
                        log('STARTING ROTATION FROM FALLBACK', {
                            source: 'checkNowPlaying fallback → showNextPoster',
                            queueLength: mediaQueue.length,
                            timestamp: new Date().toISOString(),
                        });
                        showNextPoster();
                        if (cinemaConfig.rotationIntervalMinutes > 0) {
                            startRotation();
                        }
                    } else {
                        warn('Queue still empty, cannot start rotation');
                    }
                }
            }

            initialNowPlayingCheckDone = true;
        } catch (e) {
            error('Failed to check Now Playing', e);
        }
    }

    // Filter sessions based on filterUser and device username
    function filterSessions(sessions) {
        if (!sessions || sessions.length === 0) return [];

        const nowPlayingConfig = cinemaConfig.nowPlaying || {};
        const filterUser = nowPlayingConfig.filterUser;
        const deviceUsername = getDevicePlexUsername();

        // Priority 1: Use filterUser if set
        if (filterUser) {
            return sessions.filter(s => s.username === filterUser);
        }

        // Priority 2: If device has plexUsername configured, filter by that
        if (deviceUsername) {
            const userSessions = sessions.filter(s => s.username === deviceUsername);
            if (userSessions.length > 0) {
                return userSessions;
            }
        }

        return sessions;
    }

    // Now Playing rotation timer for multiple streams
    let nowPlayingRotationTimer = null;

    function startNowPlayingRotation() {
        if (nowPlayingRotationTimer) {
            clearInterval(nowPlayingRotationTimer);
        }

        const intervalMinutes = cinemaConfig.rotationIntervalMinutes || 0;
        if (intervalMinutes <= 0) return;

        // Support decimal minutes (e.g., 0.5 = 30 seconds)
        const intervalMs = intervalMinutes * 60 * 1000;

        log('Starting Now Playing rotation', {
            intervalMinutes,
            intervalMs,
            sessionCount: nowPlayingSessions.length,
        });

        nowPlayingRotationTimer = setInterval(() => {
            if (!nowPlayingActive || nowPlayingSessions.length <= 1) {
                stopNowPlayingRotation();
                return;
            }

            // Cycle to next session
            currentSessionIndex = (currentSessionIndex + 1) % nowPlayingSessions.length;
            const session = nowPlayingSessions[currentSessionIndex];

            log('Switching to next Now Playing stream', {
                index: currentSessionIndex,
                title: session.title,
            });
            debug('NowPlayingRotation: rotating to next stream', {
                sessionIndex: currentSessionIndex,
                title: session.title,
            });

            const media = convertSessionToMedia(session);
            if (media) {
                updateCinemaDisplay(media);
                lastSessionId = session.ratingKey || session.key;
            }
        }, intervalMs);
    }

    function stopNowPlayingRotation() {
        if (nowPlayingRotationTimer) {
            clearInterval(nowPlayingRotationTimer);
            nowPlayingRotationTimer = null;
            log('Now Playing rotation stopped');
        }
    }

    function startNowPlaying() {
        try {
            if (nowPlayingTimer) {
                clearInterval(nowPlayingTimer);
                nowPlayingTimer = null;
            }

            const nowPlayingConfig = cinemaConfig.nowPlaying;
            if (!nowPlayingConfig?.enabled) {
                log('Now Playing disabled');
                return;
            }

            const intervalSeconds = nowPlayingConfig.updateIntervalSeconds || 15;
            const intervalMs = intervalSeconds * 1000;

            log('Starting Now Playing polling', { intervalSeconds });

            // Initialize Timeline Border if enabled
            initTimelineBorder(nowPlayingConfig.timelineBorder);

            // Initialize device data first, then start checking
            initNowPlayingDeviceData().then(() => {
                // Initial check
                debug('NOW PLAYING: Initial check', { timestamp: new Date().toISOString() });
                checkNowPlaying();

                // Set up polling interval
                nowPlayingTimer = setInterval(() => {
                    debug('NOW PLAYING: Poll tick', {
                        intervalSeconds,
                        timestamp: new Date().toISOString(),
                    });
                    checkNowPlaying();
                }, intervalMs);
            });
        } catch (e) {
            error('Failed to start Now Playing', e);
        }
    }

    /**
     * Initialize Timeline Border component
     * @param {object} config - Timeline border configuration
     */
    function initTimelineBorder(config) {
        if (!config?.enabled) {
            // Destroy if exists but now disabled
            if (window.PosterramaTimelineBorder) {
                window.PosterramaTimelineBorder.destroy();
            }
            return;
        }

        // Dynamically load the timeline border script if not loaded
        if (!window.PosterramaTimelineBorder) {
            const script = document.createElement('script');
            script.src = '/cinema/timeline-border.js?v=' + Date.now();
            script.async = true;
            script.onload = () => {
                if (window.PosterramaTimelineBorder) {
                    window.PosterramaTimelineBorder.init(config);
                    // Keep hidden until Now Playing is actually active.
                    if (nowPlayingActive) {
                        window.PosterramaTimelineBorder.show();
                    } else {
                        window.PosterramaTimelineBorder.hide();
                    }
                    log('Timeline border initialized');
                }
            };
            script.onerror = () => {
                warn('Failed to load timeline border module');
            };
            document.head.appendChild(script);
        } else {
            // Already loaded, just init/update
            window.PosterramaTimelineBorder.init(config);

            // Keep hidden unless Now Playing is actually active.
            if (nowPlayingActive) {
                window.PosterramaTimelineBorder.show();
            } else {
                window.PosterramaTimelineBorder.hide();
            }
        }
    }

    /**
     * Update Timeline Border with session progress
     * @param {object} session - Plex/Jellyfin session with viewOffset, duration, and state
     */
    function updateTimelineBorderProgress(session) {
        if (!window.PosterramaTimelineBorder) return;

        // Use updateFromSession which handles paused state detection
        window.PosterramaTimelineBorder.updateFromSession(session);
    }

    /**
     * Update Timeline Border auto color from poster dominant color
     * @param {string} color - Dominant color from poster (ton-sur-ton calculated)
     */
    function updateTimelineBorderAutoColor(color) {
        if (!window.PosterramaTimelineBorder) return;
        if (!color) return;

        // Calculate a brighter ton-sur-ton for better visibility
        const brighterColor = calculateTonSurTonLight(color, 60);
        window.PosterramaTimelineBorder.setAutoColor(brighterColor);
    }

    function stopNowPlaying() {
        if (nowPlayingTimer) {
            clearInterval(nowPlayingTimer);
            nowPlayingTimer = null;
            lastSessionId = null;
            nowPlayingActive = false;
            log('Now Playing stopped');
        }
        // Destroy timeline border when Now Playing is stopped
        if (window.PosterramaTimelineBorder) {
            window.PosterramaTimelineBorder.destroy();
        }
    }

    // ===== Public API =====
    window.cinemaDisplay = {
        init: initCinemaMode,
        update: updateCinemaDisplay,
        updateConfig: handleConfigUpdate,
        getConfig: () => ({ ...cinemaConfig }),
        isPinned: () => isPinned,
        getPinnedMediaId: () => pinnedMediaId,
        startRotation,
        stopRotation,
        startNowPlaying,
        stopNowPlaying,
        checkNowPlaying,
        // No debug APIs exported
    };

    // ===== Auto-Initialize on DOM Ready =====
    async function initWithCinemaConfig(config) {
        debug('Config loaded', config);

        // Initialize burn-in prevention (loads dynamically if enabled)
        // Note: burn-in prevention needs the full app config, not just cinema config
        try {
            if (window.PosterramaCore && window.PosterramaCore.initBurnInPrevention) {
                // initBurnInPrevention will fetch full config internally if needed
                await window.PosterramaCore.initBurnInPrevention();
            }
        } catch (_) {
            // Burn-in prevention is optional
        }

        debug('Calling initCinemaMode...');
        try {
            initCinemaMode(config);
            cinemaModeInitialized = true;
            log('initCinemaMode completed successfully');
        } catch (initError) {
            error('initCinemaMode crashed', {
                message: initError?.message,
                stack: initError?.stack,
            });
        }
    }

    async function autoInit() {
        try {
            debug('Auto-init starting...');

            // In admin live preview, do NOT bootstrap from saved config. The admin UI will push
            // an initial settings payload (via Core/settingsUpdated). Bootstrapping here can
            // cause a brief flash of stale pinned posters / styling.
            if (IS_PREVIEW_MODE) {
                debug('Preview mode detected; waiting for first settings update before init');

                // Fallback: if no preview init arrives (e.g., direct /cinema?preview=1), load config.
                setTimeout(() => {
                    if (cinemaModeInitialized) return;
                    (async () => {
                        const cfg = await loadCinemaConfig();
                        await initWithCinemaConfig(cfg);
                    })().catch(() => {
                        /* ignore */
                    });
                }, 2000);

                return;
            }

            const config = await loadCinemaConfig();
            await initWithCinemaConfig(config);
        } catch (e) {
            error('Auto-init failed', {
                message: e?.message,
                stack: e?.stack,
            });
        }
    }

    if (document.readyState === 'loading') {
        debug('DOM loading, adding DOMContentLoaded listener');
        document.addEventListener('DOMContentLoaded', autoInit);
    } else {
        // DOM already loaded
        debug('DOM already ready, calling autoInit');
        autoInit();
    }

    // ===== Listen for Media Changes =====
    // Hook into the global media update event if available
    // NOTE: Cinema mode manages its own media queue and display updates.
    // The bootstrap's mediaUpdated event should be ignored entirely in cinema mode
    // to prevent duplicate poster displays.
    window.addEventListener('mediaUpdated', _event => {
        // Cinema mode handles its own media - ignore bootstrap events entirely
        log('mediaUpdated event blocked: Cinema mode manages its own media');
        return;

        // Legacy code kept for reference - cinema should never process mediaUpdated:
        // if (event.detail && event.detail.media) {
        //     updateCinemaDisplay(event.detail.media);
        // }
    });

    // Listen for settingsUpdated event from core.js (preview mode, WebSocket, BroadcastChannel, etc.)
    window.addEventListener('settingsUpdated', event => {
        try {
            const settings = event.detail?.settings;
            if (!settings) return;

            // Check if cinema mode is enabled
            if (settings.cinemaMode === false) return;

            // Check if cinema config object exists with settings
            if (settings.cinema && typeof settings.cinema === 'object') {
                if (IS_PREVIEW_MODE && !cinemaModeInitialized) {
                    // Bootstrap from pushed cinema settings to avoid any initial render using
                    // stale saved config.
                    void initWithCinemaConfig(settings.cinema).then(() => {
                        handleConfigUpdate(settings);
                    });
                    return;
                }
                handleConfigUpdate(settings);
            }
        } catch (e) {
            error('Failed to handle settingsUpdated', {
                message: e?.message,
                stack: e?.stack,
            });
        }
    });

    // Recompute on resize to keep layout correct
    window.addEventListener('resize', () => updatePosterLayout());

    // Listen for live color updates from admin interface (postMessage)
    window.addEventListener('message', event => {
        // Security: verify origin matches current window
        if (event.origin !== window.location.origin) {
            return;
        }

        const data = event.data;
        if (!data || !data.type) return;

        const root = document.documentElement;

        switch (data.type) {
            case 'CINEMA_PREVIEW_TRANSITION': {
                const transition = mapTransition(String(data.transition || '').trim());
                if (!transition) return;
                if (!ALL_TRANSITIONS.includes(transition)) return;

                const posterEl = document.getElementById('poster');
                if (!posterEl) return;

                const animClass = `cinema-anim-${transition}`;
                ALL_TRANSITIONS.forEach(t => document.body.classList.remove(`cinema-anim-${t}`));
                // Force reflow to restart animation (and any pseudo-element overlays tied to body class)
                void posterEl.offsetWidth;
                document.body.classList.add(animClass);

                log('Previewed cinematic transition', { transition });
                break;
            }
            case 'CINEMA_TITLE_COLOR_UPDATE':
                if (data.color) {
                    root.style.setProperty('--cinema-title-color', data.color);
                    log('Live title color update:', data.color);
                }
                break;

            case 'CINEMA_HEADER_COLOR_UPDATE':
                if (data.color) {
                    cinemaConfig.header.typography.color = data.color;
                    createHeader();
                    log('Live header color update:', data.color);
                }
                break;

            case 'CINEMA_FOOTER_COLOR_UPDATE':
                if (data.color) {
                    cinemaConfig.footer.typography.color = data.color;
                    if (currentMedia) {
                        const cinemaMedia = mapMediaToCinemaFormat(currentMedia);
                        createFooter(cinemaMedia);
                    }
                    log('Live footer color update:', data.color);
                }
                break;

            case 'CINEMA_BACKGROUND_COLOR_UPDATE':
                if (data.color) {
                    root.style.setProperty('--cinema-bg-color', data.color);
                    cinemaConfig.background.solidColor = data.color;
                    // Also update the body background for solid mode
                    if (cinemaConfig.background.mode === 'solid') {
                        document.body.style.backgroundColor = data.color;
                    }
                    log('Live background color update:', data.color);
                }
                break;

            case 'CINEMA_FRAME_COLOR_UPDATE':
                if (data.color) {
                    root.style.setProperty('--cinema-frame-color', data.color);
                    cinemaConfig.poster.frameColor = data.color;
                    log('Live frame color update:', data.color);
                }
                break;

            case 'CINEMA_TINT_COLOR_UPDATE':
                if (data.color) {
                    root.style.setProperty('--cinema-tint-color', data.color);
                    cinemaConfig.globalEffects.tintColor = data.color;
                    log('Live tint color update:', data.color);
                }
                break;
        }
    });

    log('Cinema display module loaded');
})();
