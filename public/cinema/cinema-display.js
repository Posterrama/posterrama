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
        header: {
            enabled: true,
            text: 'Now Playing',
            style: 'classic', // classic, neon, minimal, theatre
        },
        footer: {
            enabled: true,
            type: 'specs', // marquee, specs
            marqueeText: 'Feature Presentation',
            marqueeStyle: 'classic',
            specs: {
                showResolution: true,
                showAudio: true,
                showAspectRatio: true,
                showFlags: false,
                style: 'subtle', // subtle, filled, outline
                iconSet: 'filled', // filled, line
            },
        },
        ambilight: {
            enabled: true,
            strength: 60, // 0-100
        },
    };

    // ===== DOM Element References =====
    let headerEl = null;
    let footerEl = null;
    let ambilightEl = null;

    // ===== Utility Functions =====
    function log(message, data) {
        if (window.logger && window.logger.info) {
            window.logger.info(`[Cinema Display] ${message}`, data);
        } else {
            console.log(`[Cinema Display] ${message}`, data || '');
        }
    }

    // Enable visual debugging (colored borders on layout elements)
    function enableDebugMode() {
        document.body.classList.add('debug-layout');
        log('🐛 Debug mode ENABLED - colored borders visible');
        console.log('🐛 DEBUG LAYOUT:');
        console.log('  - RED outline: #info-container (main container)');
        console.log('  - YELLOW outline + bg: .cinema-header');
        console.log('  - GREEN outline + bg: .cinema-footer');
        console.log('  - BLUE outline: #poster-wrapper');
        console.log('  - MAGENTA outline: #poster');

        // Create visual debug overlay on screen
        const debugOverlay = document.createElement('div');
        debugOverlay.id = 'debug-overlay';
        debugOverlay.style.cssText = `
            position: fixed;
            top: 10px;
            left: 10px;
            background: rgba(0, 0, 0, 0.95);
            color: #0f0;
            padding: 15px;
            font-family: monospace;
            font-size: 11px;
            line-height: 1.4;
            z-index: 99999;
            border: 2px solid #0f0;
            border-radius: 5px;
            max-width: 400px;
            pointer-events: none;
            white-space: pre-wrap;
        `;
        document.body.appendChild(debugOverlay);

        // Update measurements every 2 seconds
        const updateMeasurements = () => {
            const infoContainer = document.querySelector('#info-container');
            const header = document.querySelector('.cinema-header');
            const footer = document.querySelector('.cinema-footer, .cinema-footer-specs');
            const posterWrapper = document.querySelector('#poster-wrapper');
            const poster = document.querySelector('#poster');

            let output = '� CINEMA DEBUG MODE\n';
            output += '═══════════════════════════════\n\n';

            if (infoContainer) {
                const rect = infoContainer.getBoundingClientRect();
                const styles = window.getComputedStyle(infoContainer);
                output += `📦 #info-container (RED)\n`;
                output += `   top: ${rect.top.toFixed(0)}px\n`;
                output += `   height: ${rect.height.toFixed(0)}px\n`;
                output += `   paddingTop: ${styles.paddingTop}\n`;
                output += `   paddingBottom: ${styles.paddingBottom}\n\n`;
            }

            if (header) {
                const rect = header.getBoundingClientRect();
                output += `📝 .cinema-header (YELLOW)\n`;
                output += `   top: ${rect.top.toFixed(0)}px\n`;
                output += `   height: ${rect.height.toFixed(0)}px\n`;
                output += `   bottom: ${rect.bottom.toFixed(0)}px\n\n`;
            }

            if (posterWrapper) {
                const rect = posterWrapper.getBoundingClientRect();
                output += `🖼️  #poster-wrapper (BLUE)\n`;
                output += `   top: ${rect.top.toFixed(0)}px\n`;
                output += `   height: ${rect.height.toFixed(0)}px\n\n`;
            }

            if (poster) {
                const rect = poster.getBoundingClientRect();
                output += `🎬 #poster (MAGENTA)\n`;
                output += `   top: ${rect.top.toFixed(0)}px\n`;
                output += `   height: ${rect.height.toFixed(0)}px\n`;
                output += `   bottom: ${rect.bottom.toFixed(0)}px\n\n`;
            }

            if (footer) {
                const rect = footer.getBoundingClientRect();
                output += `📊 .cinema-footer (GREEN)\n`;
                output += `   top: ${rect.top.toFixed(0)}px\n`;
                output += `   height: ${rect.height.toFixed(0)}px\n`;
                output += `   bottom: ${rect.bottom.toFixed(0)}px\n\n`;
            }

            // Calculate spacing
            if (header && poster) {
                const headerRect = header.getBoundingClientRect();
                const posterRect = poster.getBoundingClientRect();
                const topSpacing = posterRect.top - headerRect.bottom;
                output += `📏 Space header→poster: ${topSpacing.toFixed(0)}px\n`;
            }

            if (poster && footer) {
                const posterRect = poster.getBoundingClientRect();
                const footerRect = footer.getBoundingClientRect();
                const bottomSpacing = footerRect.top - posterRect.bottom;
                output += `📏 Space poster→footer: ${bottomSpacing.toFixed(0)}px\n`;
            }

            debugOverlay.textContent = output;
        };

        // Initial update
        setTimeout(updateMeasurements, 500);

        // Update every 2 seconds
        setInterval(updateMeasurements, 2000);
    }

    function disableDebugMode() {
        document.body.classList.remove('debug-layout');
        log('Debug mode disabled');
    }

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
        body.classList.remove('cinema-auto', 'cinema-portrait', 'cinema-portrait-flipped');

        // Add new orientation class
        body.classList.add(`cinema-${orientation}`);

        log(`Applied cinema orientation: ${orientation}`);
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

        // Create or update header element
        if (!headerEl) {
            headerEl = document.createElement('div');
            headerEl.className = 'cinema-header';
            document.body.appendChild(headerEl);
        }

        // Apply header style class
        const styleClass = `cinema-header-${cinemaConfig.header.style}`;
        headerEl.className = `cinema-header ${styleClass}`;

        // Set header text
        headerEl.textContent = cinemaConfig.header.text || 'Now Playing';

        // Add body class to adjust info-container padding
        document.body.classList.add('cinema-header-active');

        log('Cinema header created/updated', {
            text: cinemaConfig.header.text,
            style: cinemaConfig.header.style,
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
            return;
        }

        // Add body class to adjust spacing
        document.body.classList.add('cinema-footer-active');

        // Create or update footer element
        if (!footerEl) {
            footerEl = document.createElement('div');
            footerEl.className = 'cinema-footer';
            document.body.appendChild(footerEl);
        }

        // Clear existing content
        footerEl.innerHTML = '';

        if (cinemaConfig.footer.type === 'marquee') {
            // Marquee footer
            const marqueeDiv = document.createElement('div');
            marqueeDiv.className = 'cinema-footer-marquee';

            const marqueeText = document.createElement('div');
            const styleClass = `cinema-footer-marquee-${cinemaConfig.footer.marqueeStyle}`;
            marqueeText.className = styleClass;
            marqueeText.textContent = cinemaConfig.footer.marqueeText || 'Feature Presentation';

            marqueeDiv.appendChild(marqueeText);
            footerEl.appendChild(marqueeDiv);

            log('Cinema footer marquee created', {
                text: cinemaConfig.footer.marqueeText,
                style: cinemaConfig.footer.marqueeStyle,
            });
        } else if (cinemaConfig.footer.type === 'specs' && currentMedia) {
            // Specs footer
            const specsDiv = document.createElement('div');
            const styleClasses = [
                'cinema-footer-specs',
                cinemaConfig.footer.specs.style,
                `icon-${cinemaConfig.footer.specs.iconSet}`,
            ].join(' ');
            specsDiv.className = styleClasses;

            // Resolution
            if (cinemaConfig.footer.specs.showResolution && currentMedia.resolution) {
                const item = document.createElement('div');
                item.className = 'cinema-spec-item';
                item.innerHTML = `<i class="fas fa-tv"></i><span>${currentMedia.resolution}</span>`;
                specsDiv.appendChild(item);
            }

            // Audio
            if (cinemaConfig.footer.specs.showAudio && currentMedia.audioCodec) {
                const item = document.createElement('div');
                item.className = 'cinema-spec-item';
                const audioText = currentMedia.audioChannels
                    ? `${currentMedia.audioCodec} ${currentMedia.audioChannels}`
                    : currentMedia.audioCodec;
                item.innerHTML = `<i class="fas fa-volume-up"></i><span>${audioText}</span>`;
                specsDiv.appendChild(item);
            }

            // Aspect Ratio
            if (cinemaConfig.footer.specs.showAspectRatio && currentMedia.aspectRatio) {
                const item = document.createElement('div');
                item.className = 'cinema-spec-item';
                item.innerHTML = `<i class="fas fa-expand"></i><span>${currentMedia.aspectRatio}</span>`;
                specsDiv.appendChild(item);
            }

            // Flags (HDR, Dolby Vision, etc.)
            if (cinemaConfig.footer.specs.showFlags) {
                if (currentMedia.hasHDR || currentMedia.hasDolbyVision) {
                    const item = document.createElement('div');
                    item.className = 'cinema-spec-item';
                    const flagText = currentMedia.hasDolbyVision ? 'Dolby Vision' : 'HDR';
                    item.innerHTML = `<i class="fas fa-sun"></i><span>${flagText}</span>`;
                    specsDiv.appendChild(item);
                }
            }

            footerEl.appendChild(specsDiv);

            log('Cinema footer specs created', {
                style: cinemaConfig.footer.specs.style,
                iconSet: cinemaConfig.footer.specs.iconSet,
                resolution: currentMedia.resolution || 'N/A',
                audioCodec: currentMedia.audioCodec || 'N/A',
                audioChannels: currentMedia.audioChannels || 'N/A',
                aspectRatio: currentMedia.aspectRatio || 'N/A',
                hasHDR: currentMedia.hasHDR || false,
                hasDolbyVision: currentMedia.hasDolbyVision || false,
            });
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

    // ===== Initialize Cinema Mode =====
    function initCinemaMode(config) {
        log('Initializing cinema mode', config);

        // Merge provided config with defaults
        if (config) {
            if (config.orientation) {
                cinemaConfig.orientation = config.orientation;
            }
            if (config.header) {
                cinemaConfig.header = { ...cinemaConfig.header, ...config.header };
            }
            if (config.footer) {
                cinemaConfig.footer = { ...cinemaConfig.footer, ...config.footer };
                if (config.footer.specs) {
                    cinemaConfig.footer.specs = {
                        ...cinemaConfig.footer.specs,
                        ...config.footer.specs,
                    };
                }
            }
            if (config.ambilight) {
                cinemaConfig.ambilight = { ...cinemaConfig.ambilight, ...config.ambilight };
            }
        }

        // Apply cinema orientation
        applyCinemaOrientation(cinemaConfig.orientation);

        // Create cinema UI elements
        createHeader();
        createAmbilight();

        log('Cinema mode initialized successfully');
    }

    // ===== Update Cinema Display =====
    function updateCinemaDisplay(currentMedia) {
        log('Updating cinema display', currentMedia);

        // Hide loader when content is ready
        const loader = document.getElementById('loader');
        if (loader) {
            loader.style.display = 'none';
        }

        // Update poster
        const posterEl = document.getElementById('poster');
        if (posterEl && currentMedia && currentMedia.posterUrl) {
            posterEl.style.backgroundImage = `url('${currentMedia.posterUrl}')`;
        }

        // Map Plex/Jellyfin/TMDB properties to cinema format
        const cinemaMedia = mapMediaToCinemaFormat(currentMedia);

        // Update footer with current media info
        createFooter(cinemaMedia);

        // Update ambilight based on poster colors
        if (cinemaConfig.ambilight.enabled && currentMedia && currentMedia.dominantColor) {
            updateAmbilightColor(currentMedia.dominantColor);
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
            initCinemaMode(newConfig.cinema);
        }
    }

    // ===== Public API =====
    window.cinemaDisplay = {
        init: initCinemaMode,
        update: updateCinemaDisplay,
        updateConfig: handleConfigUpdate,
        getConfig: () => ({ ...cinemaConfig }),
        enableDebug: enableDebugMode,
        disableDebug: disableDebugMode,
    };

    // ===== Auto-Initialize on DOM Ready =====
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', async () => {
            const config = await loadCinemaConfig();
            initCinemaMode(config);

            // Auto-enable debug mode (temporary for debugging spacing issues)
            enableDebugMode();

            log('Cinema display auto-initialized with DEBUG MODE');
        });
    } else {
        // DOM already loaded
        (async () => {
            const config = await loadCinemaConfig();
            initCinemaMode(config);

            // Auto-enable debug mode (temporary for debugging spacing issues)
            enableDebugMode();

            log('Cinema display auto-initialized with DEBUG MODE');
        })();
    }

    // ===== Listen for Media Changes =====
    // Hook into the global media update event if available
    window.addEventListener('mediaUpdated', event => {
        if (event.detail && event.detail.media) {
            updateCinemaDisplay(event.detail.media);
        }
    });

    log('Cinema display module loaded');
})();
