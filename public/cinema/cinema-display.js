'use strict';
/**
 * Cinema Display Mode
 * Author: Posterrama Team
 * Last Modified: 2025-10-12
 * License: GPL-3.0-or-later
 *
 * This module handles cinema-specific display functionality:
 * - Portrait/landscape orientation management
 * - Header/footer overlays with marquee and specs
 * - Ambilight effects
 * - Cinema-specific poster display and transitions
 */

(function () {
    // ===== Cinema Mode Configuration =====
    const cinemaConfig = {
        orientation: 'auto', // auto, portrait, portrait-flipped
        rotationIntervalMinutes: 0, // 0 = disabled (single poster)
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
            animation: 'fade', // fade, zoomIn, slideUp, cinematic, kenBurns
            transitionDuration: 1.5, // seconds
            frameColor: '#333333',
            frameWidth: 8, // pixels
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
            showTitle: true,
            showYear: true,
            showRuntime: true,
            showRating: true,
            showCertification: false,
            showGenre: false,
            showDirector: false,
            showCast: false,
            showPlot: false,
            showStudioLogo: false,
            position: 'bottom', // bottom, side, overlay
        },
        // === NEW: Promotional features ===
        promotional: {
            comingSoonBadge: false,
            showReleaseCountdown: false,
            qrCode: {
                enabled: false,
                url: '',
                position: 'bottomRight',
                size: 100,
            },
            announcementBanner: {
                enabled: false,
                text: '',
                style: 'ticker', // ticker, static, flash
            },
        },
    };

    // ===== State =====
    let currentMedia = null; // Track current media for live updates
    let isPinned = false; // Track if current poster is pinned
    let pinnedMediaId = null; // Store pinned media ID
    let rotationTimer = null; // Timer for automatic poster rotation
    let mediaQueue = []; // Queue of media items for rotation
    let nowPlayingTimer = null; // Timer for Now Playing session polling
    let lastSessionId = null; // Track last active session to detect changes
    let nowPlayingActive = false; // Track if currently showing Now Playing poster

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
            const bar = Math.max(0, Math.round((vh - posterHeight) / 2));
            document.documentElement.style.setProperty('--poster-top', bar + 'px');
            document.documentElement.style.setProperty('--poster-bottom', bar + 'px');
        } catch (e) {
            console.warn('updatePosterLayout error', e);
        }
    }

    // ===== Utility Functions =====
    function log(message, data) {
        if (window.logger && window.logger.info) {
            window.logger.info(`[Cinema Display] ${message}`, data);
        } else {
            console.log(`[Cinema Display] ${message}`, data || '');
        }
    }

    // Debug overlay removed for production

    function error(message, data) {
        if (window.logger && window.logger.error) {
            window.logger.error(`[Cinema] ${message}`, data);
        } else {
            console.error(`[Cinema] ${message}`, data || '');
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

    // ===== Cinema Header =====
    function createHeader() {
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
            document.body.appendChild(headerEl);
        }

        // Apply header typography classes
        const fontClass = `font-${typo.fontFamily || 'cinematic'}`;
        const shadowClass = `shadow-${typo.shadow || 'subtle'}`;
        const animClass =
            typo.animation && typo.animation !== 'none' ? `anim-${typo.animation}` : '';
        headerEl.className = `cinema-header ${fontClass} ${shadowClass} ${animClass}`.trim();

        // Apply inline styles for size and color
        headerEl.style.setProperty('--header-font-size', `${(typo.fontSize || 100) / 100}`);
        headerEl.style.setProperty('--header-color', typo.color || '#ffffff');

        // Set header text
        headerEl.textContent = cinemaConfig.header.text || 'Now Playing';

        // Add body class to adjust info-container padding
        document.body.classList.add('cinema-header-active');

        // Update poster layout after header changes
        updatePosterLayout();

        log('Cinema header created/updated', {
            text: cinemaConfig.header.text,
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
        footerEl.className = `cinema-footer ${fontClass} ${shadowClass}`;
        footerEl.style.setProperty('--footer-font-size', `${(typo.fontSize || 100) / 100}`);
        footerEl.style.setProperty('--footer-color', typo.color || '#cccccc');

        // Clear existing content
        footerEl.innerHTML = '';

        if (cinemaConfig.footer.type === 'marquee') {
            // Marquee footer
            const marqueeDiv = document.createElement('div');
            marqueeDiv.className = 'cinema-footer-marquee';

            const marqueeText = document.createElement('div');
            marqueeText.className = 'cinema-footer-marquee-content';
            marqueeText.textContent = cinemaConfig.footer.marqueeText || 'Feature Presentation';

            marqueeDiv.appendChild(marqueeText);
            footerEl.appendChild(marqueeDiv);

            log('Cinema footer marquee created', {
                text: cinemaConfig.footer.marqueeText,
                typography: typo,
            });
        } else if (cinemaConfig.footer.type === 'metadata' && currentMedia) {
            // Metadata footer - use metadata.specs settings
            const meta = cinemaConfig.metadata || {};
            const specs = meta.specs || {};

            const specsDiv = document.createElement('div');
            specsDiv.className = `cinema-footer-specs ${specs.style || 'badges'} icon-${specs.iconSet || 'filled'}`;

            // Resolution
            if (specs.showResolution !== false && currentMedia.resolution) {
                const item = document.createElement('div');
                item.className = 'cinema-spec-item';
                item.innerHTML = `<i class="fas fa-tv"></i><span>${currentMedia.resolution}</span>`;
                specsDiv.appendChild(item);
            }

            // Audio
            if (specs.showAudio !== false && currentMedia.audioCodec) {
                const item = document.createElement('div');
                item.className = 'cinema-spec-item';
                const audioText = currentMedia.audioChannels
                    ? `${currentMedia.audioCodec} ${currentMedia.audioChannels}`
                    : currentMedia.audioCodec;
                item.innerHTML = `<i class="fas fa-volume-up"></i><span>${audioText}</span>`;
                specsDiv.appendChild(item);
            }

            // HDR
            if (specs.showHDR !== false && (currentMedia.hasHDR || currentMedia.hasDolbyVision)) {
                const item = document.createElement('div');
                item.className = 'cinema-spec-item';
                const flagText = currentMedia.hasDolbyVision ? 'Dolby Vision' : 'HDR';
                item.innerHTML = `<i class="fas fa-sun"></i><span>${flagText}</span>`;
                specsDiv.appendChild(item);
            }

            // Aspect Ratio
            if (specs.showAspectRatio && currentMedia.aspectRatio) {
                const item = document.createElement('div');
                item.className = 'cinema-spec-item';
                item.innerHTML = `<i class="fas fa-expand"></i><span>${currentMedia.aspectRatio}</span>`;
                specsDiv.appendChild(item);
            }

            footerEl.appendChild(specsDiv);

            log('Cinema footer metadata/specs created', {
                style: specs.style,
                iconSet: specs.iconSet,
                resolution: currentMedia.resolution || 'N/A',
            });
        } else if (cinemaConfig.footer.type === 'tagline' && currentMedia) {
            // Tagline footer - displays the movie/series tagline
            const taglineDiv = document.createElement('div');
            taglineDiv.className = 'cinema-footer-tagline';

            const taglineText = currentMedia.tagline || currentMedia.summary?.split('.')[0] || '';
            if (taglineText) {
                taglineDiv.textContent = taglineText;
                footerEl.appendChild(taglineDiv);

                log('Cinema footer tagline created', {
                    tagline: taglineText,
                });
            } else {
                // Fallback: show title if no tagline available
                taglineDiv.textContent = currentMedia.title || '';
                taglineDiv.classList.add('fallback-title');
                footerEl.appendChild(taglineDiv);
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
    function createQRCode(_currentMedia) {
        const promo = cinemaConfig.promotional || {};
        const qrConfig = promo.qrCode || {};

        // Remove existing QR code
        if (qrCodeEl) {
            qrCodeEl.remove();
            qrCodeEl = null;
        }

        if (!qrConfig.enabled || !qrConfig.url) {
            return;
        }

        // Create QR code element
        qrCodeEl = document.createElement('div');
        qrCodeEl.className = `cinema-qr-code position-${qrConfig.position || 'bottomRight'}`;

        // Generate QR code using canvas (simple QR code generator)
        // For now, use a QR code service or placeholder
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${qrConfig.size || 100}x${qrConfig.size || 100}&data=${encodeURIComponent(qrConfig.url)}`;
        const img = document.createElement('img');
        img.src = qrUrl;
        img.alt = 'QR Code';
        img.style.width = `${qrConfig.size || 100}px`;
        img.style.height = `${qrConfig.size || 100}px`;
        img.loading = 'lazy';

        qrCodeEl.appendChild(img);
        document.body.appendChild(qrCodeEl);

        log('QR Code created', { url: qrConfig.url, position: qrConfig.position });
    }

    // ===== Announcement Banner (Promotional) =====
    let announcementEl = null;
    function createAnnouncementBanner() {
        const promo = cinemaConfig.promotional || {};
        const banner = promo.announcementBanner || {};

        // Remove existing announcement
        if (announcementEl) {
            announcementEl.remove();
            announcementEl = null;
        }

        if (!banner.enabled || !banner.text) {
            return;
        }

        // Create announcement element
        announcementEl = document.createElement('div');
        announcementEl.className = `cinema-announcement style-${banner.style || 'ticker'}`;

        const textEl = document.createElement('span');
        textEl.className = 'announcement-text';
        textEl.textContent = banner.text;

        announcementEl.appendChild(textEl);
        document.body.appendChild(announcementEl);

        log('Announcement banner created', { text: banner.text, style: banner.style });
    }

    // ===== Typography Settings (Global CSS Variables) =====
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

    // ===== Background Settings =====
    async function applyBackgroundSettings(media) {
        const root = document.documentElement;
        const bg = cinemaConfig.background;

        // Apply background mode class
        document.body.classList.remove(
            'cinema-bg-solid',
            'cinema-bg-blurred',
            'cinema-bg-gradient',
            'cinema-bg-ambient'
        );
        document.body.classList.add(`cinema-bg-${bg.mode}`);

        // Set CSS variables
        root.style.setProperty('--cinema-bg-color', bg.solidColor);
        root.style.setProperty('--cinema-bg-blur', `${bg.blurAmount}px`);

        // Set poster URL for blurred background
        if (media) {
            const posterUrl = media.posterUrl || media.poster_path || '';
            if (posterUrl) {
                root.style.setProperty('--cinema-poster-url', `url('${posterUrl}')`);

                // Extract dominant color if not provided
                let dominantColor = media.dominantColor;
                if (!dominantColor && (bg.mode === 'gradient' || bg.mode === 'ambient')) {
                    dominantColor = await extractDominantColor(posterUrl);
                    log('Extracted dominant color:', dominantColor);
                }
                dominantColor = dominantColor || '#2a2a4a';

                // Set gradient/ambient colors
                root.style.setProperty('--cinema-ambient-color', dominantColor);
                root.style.setProperty('--cinema-gradient-start', '#0f0f0f');
                root.style.setProperty('--cinema-gradient-mid', dominantColor);
                root.style.setProperty('--cinema-gradient-end', '#0f0f0f');
            }
        }

        // Vignette presets
        const vignetteMap = {
            none: 'none',
            subtle: 'radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.4) 100%)',
            dramatic: 'radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.8) 100%)',
        };
        root.style.setProperty('--cinema-vignette', vignetteMap[bg.vignette] || vignetteMap.subtle);

        log('Background settings applied', bg);
    }

    // ===== Poster Settings =====
    function applyPosterSettings() {
        const root = document.documentElement;
        const poster = cinemaConfig.poster;

        // Remove existing poster style classes (perspective removed)
        document.body.classList.remove(
            'cinema-poster-fullBleed',
            'cinema-poster-framed',
            'cinema-poster-floating'
        );
        document.body.classList.add(`cinema-poster-${poster.style}`);

        // Remove existing animation classes (kenBurns removed)
        document.body.classList.remove(
            'cinema-anim-fade',
            'cinema-anim-zoomIn',
            'cinema-anim-slideUp',
            'cinema-anim-cinematic'
        );
        document.body.classList.add(`cinema-anim-${poster.animation}`);

        // Set CSS variables
        root.style.setProperty('--cinema-poster-transition', `${poster.transitionDuration}s`);
        root.style.setProperty('--cinema-frame-color', poster.frameColor);
        root.style.setProperty('--cinema-frame-width', `${poster.frameWidth}px`);

        log('Poster settings applied', poster);
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
            // === Merge poster settings ===
            if (config.poster) {
                cinemaConfig.poster = { ...cinemaConfig.poster, ...config.poster };
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
                if (config.promotional.announcementBanner) {
                    cinemaConfig.promotional.announcementBanner = {
                        ...cinemaConfig.promotional.announcementBanner,
                        ...config.promotional.announcementBanner,
                    };
                }
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

        // Create cinema UI elements
        createHeader();
        createAmbilight();

        // Always fetch media queue for fallback scenarios
        // Even when Now Playing is enabled, we need the queue for when sessions end
        (async () => {
            mediaQueue = await fetchMediaQueue();
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
        })();

        // Initialize Now Playing if enabled (takes priority over rotation)
        if (cinemaConfig.nowPlaying?.enabled) {
            startNowPlaying();
        } else {
            // Start rotation if enabled and Now Playing is disabled
            if (cinemaConfig.rotationIntervalMinutes > 0) {
                // Wait for queue to load before starting rotation
                (async () => {
                    await new Promise(resolve => setTimeout(resolve, 100)); // Small delay to ensure queue is loaded
                    if (mediaQueue.length > 0) {
                        startRotation();
                    }
                })();
            }
        }

        log('Cinema mode initialized successfully');
    }

    // ===== Update Cinema Display =====
    function updateCinemaDisplay(media) {
        log('Updating cinema display', media);

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
        }

        // PROGRESSIVE LOADING: Show thumbnail first, then upgrade to full quality
        const posterEl = document.getElementById('poster');
        if (posterEl && media && media.posterUrl) {
            const url = media.posterUrl;
            // Show low-quality thumbnail immediately
            const thumbUrl = url.includes('?')
                ? `${url}&quality=30&width=400`
                : `${url}?quality=30&width=400`;

            posterEl.style.backgroundImage = `url('${thumbUrl}')`;
            posterEl.style.filter = 'blur(3px)';
            posterEl.style.transition = 'filter 0.5s ease-out';

            // Load full quality in background
            const fullImg = new Image();
            fullImg.onload = () => {
                posterEl.style.backgroundImage = `url('${url}')`;
                posterEl.style.filter = 'none';
            };
            fullImg.onerror = () => {
                // Keep thumbnail, just remove blur
                posterEl.style.filter = 'none';
            };
            fullImg.src = url;
        }

        // Map Plex/Jellyfin/TMDB properties to cinema format
        const cinemaMedia = mapMediaToCinemaFormat(media);

        // Update background with media info (for blurred/gradient/ambient modes)
        applyBackgroundSettings(media);

        // Update footer with current media info
        createFooter(cinemaMedia);

        // Create/update promotional elements
        createQRCode(cinemaMedia);
        createAnnouncementBanner();

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

        // Map resolution from Plex qualityLabel or videoStreams
        let resolution = media.qualityLabel || null;
        if (!resolution && media.videoStreams && media.videoStreams.length > 0) {
            const video = media.videoStreams[0];
            if (video.height) {
                if (video.height >= 2160) resolution = '4K';
                else if (video.height >= 1080) resolution = '1080p';
                else if (video.height >= 720) resolution = '720p';
                else resolution = 'SD';
            }
        }

        // Map audio codec from audioTracks
        let audioCodec = null;
        let audioChannels = null;
        if (media.audioTracks && media.audioTracks.length > 0) {
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

            if (audio.channels) {
                const ch = audio.channels;
                if (ch >= 8) audioChannels = '7.1';
                else if (ch >= 6) audioChannels = '5.1';
                else if (ch === 2) audioChannels = '2.0';
                else audioChannels = `${ch}.0`;
            }
        }

        // Map aspect ratio from videoStreams
        let aspectRatio = null;
        if (media.videoStreams && media.videoStreams.length > 0) {
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
            const response = await fetch('/get-config');
            if (!response.ok) {
                throw new Error(`Failed to load config: ${response.status}`);
            }

            const data = await response.json();
            return data.cinema || {};
        } catch (err) {
            error('Failed to load cinema configuration', err);
            return {};
        }
    }

    // ===== Handle Configuration Updates =====
    function handleConfigUpdate(newConfig) {
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
                    if (newConfig.cinema.nowPlaying.enabled) {
                        startNowPlaying();
                    } else if (cinemaConfig.rotationIntervalMinutes > 0) {
                        startRotation();
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
                    startRotation();
                }
            }

            // Apply orientation if changed
            if (newConfig.cinema.orientation && newConfig.cinema.orientation !== oldOrientation) {
                console.log(
                    '[Cinema] Orientation changed, applying:',
                    newConfig.cinema.orientation
                );
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

            // Update poster settings
            if (newConfig.cinema.poster) {
                cinemaConfig.poster = { ...cinemaConfig.poster, ...newConfig.cinema.poster };
                applyPosterSettings();
            }

            // Update background settings
            if (newConfig.cinema.background) {
                cinemaConfig.background = {
                    ...cinemaConfig.background,
                    ...newConfig.cinema.background,
                };
                applyBackgroundSettings(currentMedia);
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
                // Deep merge announcementBanner
                if (newConfig.cinema.promotional.announcementBanner) {
                    cinemaConfig.promotional.announcementBanner = {
                        ...cinemaConfig.promotional.announcementBanner,
                        ...newConfig.cinema.promotional.announcementBanner,
                    };
                }
                // Create/update promotional elements
                if (currentMedia) {
                    const cinemaMedia = mapMediaToCinemaFormat(currentMedia);
                    createQRCode(cinemaMedia);
                    createAnnouncementBanner();
                }
            }
        }
    }

    // ===== Playback Control API =====
    window.__posterramaPlayback = {
        pinPoster: payload => {
            try {
                isPinned = true;
                pinnedMediaId = payload?.mediaId || window.__posterramaCurrentMediaId || null;
                window.__posterramaPaused = true;

                log('Poster pinned', { mediaId: pinnedMediaId });

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
                error('Failed to pin poster', e);
            }
        },
        resume: () => {
            try {
                isPinned = false;
                pinnedMediaId = null;
                window.__posterramaPaused = false;

                log('Poster unpinned, rotation resumed');

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
                log('Playback paused');
            } catch (_) {
                /* ignore */
            }
        },
        next: () => {
            try {
                if (isPinned) {
                    isPinned = false;
                    pinnedMediaId = null;
                    window.__posterramaPaused = false;
                }
                showNextPoster();
            } catch (e) {
                error('Failed to show next poster', e);
            }
        },
        prev: () => {
            try {
                if (isPinned) {
                    isPinned = false;
                    pinnedMediaId = null;
                    window.__posterramaPaused = false;
                }
                showPreviousPoster();
            } catch (e) {
                error('Failed to show previous poster', e);
            }
        },
    };

    // ===== Poster Rotation Functions =====
    let currentMediaIndex = 0;

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
            const cfg = window.appConfig || {};
            const type = (cfg && cfg.type) || 'movies';

            // Check if games mode is active
            const wallartMode = window.__serverConfig?.wallartMode || {};
            const isGamesOnly = wallartMode.gamesOnly === true;

            // Build URL with appropriate parameter
            let url = `/get-media?count=50&type=${encodeURIComponent(type)}`;
            if (isGamesOnly) {
                url += '&gamesOnly=true';
            } else {
                url += '&excludeGames=1';
            }

            const res = await fetch(url, {
                cache: 'no-cache',
                headers: { 'Cache-Control': 'no-cache' },
            });
            if (!res.ok) return [];
            const data = await res.json();
            const items = Array.isArray(data)
                ? data
                : Array.isArray(data?.results)
                  ? data.results
                  : [];
            log('Fetched media queue', { count: items.length });
            return items;
        } catch (e) {
            error('Failed to fetch media queue', e);
            return [];
        }
    }

    function showNextPoster() {
        try {
            // Don't rotate if Now Playing is active
            if (nowPlayingActive) {
                log('Rotation skipped: Now Playing is active');
                return;
            }

            if (mediaQueue.length === 0) {
                log('No media in queue for rotation');
                return;
            }

            currentMediaIndex = (currentMediaIndex + 1) % mediaQueue.length;
            const nextMedia = mediaQueue[currentMediaIndex];

            log('Showing next poster', { index: currentMediaIndex, title: nextMedia?.title });
            updateCinemaDisplay(nextMedia);

            // Dispatch mediaUpdated event for consistency
            window.dispatchEvent(new CustomEvent('mediaUpdated', { detail: { media: nextMedia } }));
        } catch (e) {
            error('Failed to show next poster', e);
        }
    }

    function showPreviousPoster() {
        try {
            if (mediaQueue.length === 0) {
                log('No media in queue for rotation');
                return;
            }

            currentMediaIndex = (currentMediaIndex - 1 + mediaQueue.length) % mediaQueue.length;
            const prevMedia = mediaQueue[currentMediaIndex];

            log('Showing previous poster', { index: currentMediaIndex, title: prevMedia?.title });
            updateCinemaDisplay(prevMedia);

            // Dispatch mediaUpdated event for consistency
            window.dispatchEvent(new CustomEvent('mediaUpdated', { detail: { media: prevMedia } }));
        } catch (e) {
            error('Failed to show previous poster', e);
        }
    }

    // ===== Now Playing Integration =====
    async function initNowPlayingDeviceData() {
        try {
            const deviceState = window.PosterramaDevice?.getState?.();
            if (!deviceState?.deviceId) return;

            const res = await fetch(`/api/devices/${deviceState.deviceId}`, {
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
            const res = await fetch('/api/plex/sessions', {
                cache: 'no-cache',
                headers: { 'Cache-Control': 'no-cache' },
                credentials: 'include',
            });
            if (!res.ok) return null;
            const data = await res.json();

            // Cache server name for image proxy URLs
            if (data?.serverName) {
                window.__plexServerName = data.serverName;
            }

            return data?.sessions || [];
        } catch (e) {
            error('Failed to fetch Plex sessions', e);
            return null;
        }
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

        // Priority 1: If priority is 'user' and filterUser is set, filter by that username
        if (priority === 'user' && filterUser) {
            const userSessions = sessions.filter(s => s.username === filterUser);
            if (userSessions.length > 0) {
                log('Filtered sessions by configured filterUser', {
                    username: filterUser,
                    count: userSessions.length,
                });
                // Return first session for this user (user filter always takes first)
                return userSessions[0];
            }
            // No sessions for filterUser, return null (will trigger fallback)
            log('No sessions found for filterUser', { username: filterUser });
            return null;
        }

        // Priority 2: If device has plexUsername configured, filter by that username
        if (deviceUsername) {
            const userSessions = sessions.filter(s => s.username === deviceUsername);
            if (userSessions.length > 0) {
                sessions = userSessions;
                log('Filtered sessions by device username', {
                    username: deviceUsername,
                    count: sessions.length,
                });
            }
        }

        // Select based on priority
        if (priority === 'random') {
            return sessions[Math.floor(Math.random() * sessions.length)];
        }
        // Default: first session
        return sessions[0];
    }

    function convertSessionToMedia(session) {
        try {
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

            return {
                id: session.ratingKey || session.key || `session-${Date.now()}`,
                key: `plex-session-${session.ratingKey || session.key}`,
                title: displayTitle,
                year: session.year || null,
                rating: session.contentRating || null,
                overview: session.summary || null,
                posterUrl: posterUrl, // Use posterUrl not poster_path for Cinema compatibility
                backgroundUrl: backdropUrl,
                thumbnailUrl: posterUrl,
                genres: [],
                runtime: session.duration ? Math.round(session.duration / 60000) : null,
                type: session.type === 'episode' ? 'tv' : 'movie',
                source: 'plex-session',
            };
        } catch (e) {
            error('Failed to convert session to media', e);
            return null;
        }
    }

    async function checkNowPlaying() {
        try {
            const nowPlayingConfig = cinemaConfig.nowPlaying;
            if (!nowPlayingConfig?.enabled) return;

            const sessions = await fetchPlexSessions();
            const selectedSession = selectSession(sessions);

            if (selectedSession) {
                const sessionId = selectedSession.ratingKey || selectedSession.key;

                // Stop rotation when we have an active session
                if (!nowPlayingActive) {
                    stopRotation();
                }

                // Only update if session changed
                if (sessionId !== lastSessionId) {
                    log('New active session detected', { sessionId, title: selectedSession.title });
                    lastSessionId = sessionId;
                    nowPlayingActive = true;

                    const media = convertSessionToMedia(selectedSession);
                    if (media) {
                        updateCinemaDisplay(media);
                    }
                }
            } else {
                // No active sessions
                if (nowPlayingActive) {
                    log('No active sessions, applying fallback behavior');
                    lastSessionId = null;
                    nowPlayingActive = false;

                    // Apply fallback behavior - restart rotation
                    if (nowPlayingConfig.fallbackToRotation) {
                        // Return to rotation mode
                        startRotation();
                        if (mediaQueue.length > 0) {
                            showNextPoster();
                        }
                    }
                }
            }
        } catch (e) {
            error('Failed to check Now Playing', e);
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

            // Initialize device data first, then start checking
            initNowPlayingDeviceData().then(() => {
                // Initial check
                checkNowPlaying();

                // Set up polling interval
                nowPlayingTimer = setInterval(() => {
                    checkNowPlaying();
                }, intervalMs);
            });
        } catch (e) {
            error('Failed to start Now Playing', e);
        }
    }

    function stopNowPlaying() {
        if (nowPlayingTimer) {
            clearInterval(nowPlayingTimer);
            nowPlayingTimer = null;
            lastSessionId = null;
            nowPlayingActive = false;
            log('Now Playing stopped');
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
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', async () => {
            const config = await loadCinemaConfig();
            initCinemaMode(config);

            // Debug overlay removed
        });
    } else {
        // DOM already loaded
        (async () => {
            const config = await loadCinemaConfig();
            initCinemaMode(config);

            // Debug overlay removed
        })();
    }

    // ===== Listen for Media Changes =====
    // Hook into the global media update event if available
    window.addEventListener('mediaUpdated', event => {
        // Don't process mediaUpdated events when Now Playing is active
        if (nowPlayingActive) {
            log('mediaUpdated event blocked: Now Playing is active');
            return;
        }

        if (event.detail && event.detail.media) {
            updateCinemaDisplay(event.detail.media);
        }
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
                handleConfigUpdate(settings);
            }
        } catch (e) {
            console.error('[Cinema] Failed to handle settingsUpdated:', e);
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
        }
    });

    log('Cinema display module loaded');
})();
