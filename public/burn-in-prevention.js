/**
 * Burn-in Prevention Frontend Module
 *
 * Provides screen burn-in protection for OLED/Plasma displays.
 * This module is dynamically loaded only when burn-in prevention is enabled.
 *
 * Features:
 * - Pixel shifting: Subtle movement of all content to prevent static burn-in
 * - Element cycling: Periodic repositioning of static UI elements (clock, logos)
 * - Screen refresh: Optional periodic screen blanking/color wipe
 *
 * @module public/burn-in-prevention
 */

(function (global) {
    'use strict';

    const MODULE_NAME = 'BurnInPrevention';

    // Default values for burn-in prevention (must match backend lib/burn-in-prevention.js)
    const DEFAULTS = {
        pixelShift: {
            amount: 2, // pixels
            intervalMs: 180000, // 3 minutes
        },
        elementCycling: {
            intervalMs: 300000, // 5 minutes
            fadeMs: 500,
        },
        screenRefresh: {
            intervalMs: 3600000, // 1 hour
            type: 'blackout',
            durationMs: 100,
        },
    };

    // Level presets (must match backend)
    // NOTE: Values are intentionally subtle - burn-in prevention should be imperceptible
    const LEVEL_PRESETS = {
        subtle: {
            pixelShift: { amount: 1, intervalMs: 300000 }, // 5 min, 1px
        },
        moderate: {
            pixelShift: { amount: 2, intervalMs: 300000 }, // 5 min, 2px
            elementCycling: { intervalMs: 900000 }, // 15 min
        },
        aggressive: {
            pixelShift: { amount: 2, intervalMs: 120000 }, // 2 min, 2px (still subtle!)
            elementCycling: { intervalMs: 600000 }, // 10 min
            screenRefresh: { intervalMs: 3600000 }, // 1 hour
        },
    };

    // State
    let _config = null;
    let _enabled = false;
    let _pixelShiftTimer = null;
    let _elementCycleTimer = null;
    let _screenRefreshTimer = null;
    const _currentShift = { x: 0, y: 0 };
    const _shiftDirection = { x: 1, y: 1 };
    let _rootElement = null;
    let _staticElements = [];
    let _elementPositions = [];
    let _refreshOverlay = null;

    /**
     * Resolve config with defaults based on level
     */
    function resolveConfig(config) {
        const level = config.level || 'subtle';
        const preset = LEVEL_PRESETS[level] || LEVEL_PRESETS.subtle;

        return {
            ...config,
            pixelShift: {
                ...DEFAULTS.pixelShift,
                ...(preset.pixelShift || {}),
                ...(config.pixelShift || {}),
            },
            elementCycling: {
                ...DEFAULTS.elementCycling,
                ...(preset.elementCycling || {}),
                ...(config.elementCycling || {}),
            },
            screenRefresh: {
                ...DEFAULTS.screenRefresh,
                ...(preset.screenRefresh || {}),
                ...(config.screenRefresh || {}),
            },
        };
    }

    /**
     * Initialize burn-in prevention
     * @param {object} config - Burn-in prevention configuration from server
     */
    function init(config) {
        if (!config || !config.enabled) {
            log('Burn-in prevention disabled');
            return;
        }

        // Resolve config with defaults based on level
        _config = resolveConfig(config);
        _enabled = true;
        _rootElement = document.documentElement;

        log(`Initializing with level: ${_config.level}`);
        log(
            `Pixel shift: ${_config.pixelShift.amount}px every ${_config.pixelShift.intervalMs / 1000}s`
        );

        // Start pixel shifting
        if (_config.pixelShift && _config.pixelShift.enabled) {
            startPixelShift();
        }

        // Start element cycling
        if (_config.elementCycling && _config.elementCycling.enabled) {
            startElementCycling();
        }

        // Start screen refresh
        if (_config.screenRefresh && _config.screenRefresh.enabled) {
            startScreenRefresh();
        }

        // Handle visibility changes
        document.addEventListener('visibilitychange', handleVisibilityChange);

        log('Burn-in prevention active');
    }

    /**
     * Stop all burn-in prevention activities
     */
    function destroy() {
        _enabled = false;

        if (_pixelShiftTimer) {
            clearInterval(_pixelShiftTimer);
            _pixelShiftTimer = null;
        }

        if (_elementCycleTimer) {
            clearInterval(_elementCycleTimer);
            _elementCycleTimer = null;
        }

        if (_screenRefreshTimer) {
            clearInterval(_screenRefreshTimer);
            _screenRefreshTimer = null;
        }

        // Reset pixel shift
        if (_rootElement) {
            _rootElement.style.transform = '';
        }

        // Remove refresh overlay if exists
        if (_refreshOverlay && _refreshOverlay.parentNode) {
            _refreshOverlay.parentNode.removeChild(_refreshOverlay);
            _refreshOverlay = null;
        }

        document.removeEventListener('visibilitychange', handleVisibilityChange);

        log('Burn-in prevention destroyed');
    }

    // ========================================
    // Pixel Shifting
    // ========================================

    /**
     * Start pixel shift timer
     */
    function startPixelShift() {
        const amount = _config.pixelShift.amount || 2;
        const intervalMs = _config.pixelShift.intervalMs || 300000; // Default 5 min

        // Sanity check - minimum 30 seconds to prevent runaway
        const safeInterval = Math.max(intervalMs, 30000);

        log(`Pixel shift: ${amount}px every ${safeInterval / 1000}s`);

        // Initial shift
        applyPixelShift();

        // Start timer
        _pixelShiftTimer = setInterval(applyPixelShift, safeInterval);
    }

    /**
     * Apply pixel shift transformation
     * Uses a wandering pattern to avoid predictable movement
     * Movement is intentionally very subtle and slow
     */
    function applyPixelShift() {
        if (!_enabled || !_config.pixelShift) return;

        const amount = _config.pixelShift.amount || 2;

        // Update shift position - move to a new random position within bounds
        // This creates a gentle, imperceptible shift
        _currentShift.x = (Math.random() - 0.5) * 2 * amount;
        _currentShift.y = (Math.random() - 0.5) * 2 * amount;

        // Apply transformation
        const transform = `translate(${_currentShift.x.toFixed(2)}px, ${_currentShift.y.toFixed(2)}px)`;

        // Apply to root content container if exists, otherwise documentElement
        const container =
            document.querySelector('.posterrama-root') ||
            document.querySelector('.screensaver-container') ||
            document.querySelector('.wallart-container') ||
            document.querySelector('.cinema-container') ||
            _rootElement;

        if (container) {
            container.style.transform = transform;
        }
    }

    // ========================================
    // Element Cycling
    // ========================================

    /**
     * Start element cycling timer
     */
    function startElementCycling() {
        const { intervalMs } = _config.elementCycling;

        log(`Element cycling every ${intervalMs / 1000}s`);

        // Find and track static elements
        discoverStaticElements();

        // Start timer
        _elementCycleTimer = setInterval(cycleElements, intervalMs);
    }

    /**
     * Discover static UI elements that need protection
     */
    function discoverStaticElements() {
        _staticElements = [];
        _elementPositions = [];

        // Common static element selectors
        const selectors = [
            '#clock',
            '#clock-widget',
            '.clock-widget',
            '#logo',
            '.site-logo',
            '#header',
            '.cinema-header',
            '#footer',
            '.cinema-footer',
            '.static-overlay',
            '[data-burn-in-protect]',
        ];

        selectors.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            elements.forEach(el => {
                if (el && !_staticElements.includes(el)) {
                    _staticElements.push(el);
                    // Store original position
                    const rect = el.getBoundingClientRect();
                    const computed = window.getComputedStyle(el);
                    _elementPositions.push({
                        element: el,
                        originalTop: computed.top,
                        originalLeft: computed.left,
                        originalRight: computed.right,
                        originalBottom: computed.bottom,
                        width: rect.width,
                        height: rect.height,
                    });
                }
            });
        });

        log(`Found ${_staticElements.length} static elements to protect`);
    }

    /**
     * Cycle static element positions
     */
    function cycleElements() {
        if (!_enabled || _staticElements.length === 0) return;

        const fadeMs = _config.elementCycling.fadeMs || 500;

        _staticElements.forEach((el, index) => {
            const pos = _elementPositions[index];
            if (!pos) return;

            // Calculate subtle position offset (5-15px range)
            const offsetX = Math.round((Math.random() - 0.5) * 20);
            const offsetY = Math.round((Math.random() - 0.5) * 10);

            // Apply with fade transition
            el.style.transition = `transform ${fadeMs}ms ease-in-out, opacity ${fadeMs / 2}ms ease-in-out`;

            // Fade out slightly, move, fade back
            el.style.opacity = '0.7';

            setTimeout(() => {
                el.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
                el.style.opacity = '1';
            }, fadeMs / 2);
        });
    }

    // ========================================
    // Screen Refresh
    // ========================================

    /**
     * Start screen refresh timer
     */
    function startScreenRefresh() {
        const { intervalMs, type } = _config.screenRefresh;

        log(`Screen refresh (${type}) every ${intervalMs / 60000}min`);

        // Create overlay element
        createRefreshOverlay();

        // Start timer
        _screenRefreshTimer = setInterval(performScreenRefresh, intervalMs);
    }

    /**
     * Create the refresh overlay element
     */
    function createRefreshOverlay() {
        if (_refreshOverlay) return;

        _refreshOverlay = document.createElement('div');
        _refreshOverlay.id = 'burn-in-refresh-overlay';
        _refreshOverlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            z-index: 999999;
            pointer-events: none;
            opacity: 0;
            transition: opacity 50ms ease-in-out;
            background: #000;
        `;

        document.body.appendChild(_refreshOverlay);
    }

    /**
     * Perform screen refresh
     */
    function performScreenRefresh() {
        if (!_enabled || !_refreshOverlay) return;

        const { type, durationMs } = _config.screenRefresh;

        if (type === 'blackout') {
            // Quick black flash
            _refreshOverlay.style.background = '#000';
            _refreshOverlay.style.opacity = '1';

            setTimeout(() => {
                _refreshOverlay.style.opacity = '0';
            }, durationMs || 100);
        } else if (type === 'colorWipe') {
            // Color wipe animation
            const colors = ['#ff0000', '#00ff00', '#0000ff', '#000000'];
            let colorIndex = 0;
            const wipeInterval = (durationMs || 400) / colors.length;

            const wipe = () => {
                if (colorIndex >= colors.length) {
                    _refreshOverlay.style.opacity = '0';
                    return;
                }

                _refreshOverlay.style.background = colors[colorIndex];
                _refreshOverlay.style.opacity = '1';
                colorIndex++;

                setTimeout(wipe, wipeInterval);
            };

            wipe();
        }
    }

    // ========================================
    // Utilities
    // ========================================

    /**
     * Handle page visibility changes
     */
    function handleVisibilityChange() {
        if (document.hidden) {
            // Pause when hidden (save CPU)
            if (_pixelShiftTimer) clearInterval(_pixelShiftTimer);
            if (_elementCycleTimer) clearInterval(_elementCycleTimer);
            if (_screenRefreshTimer) clearInterval(_screenRefreshTimer);
        } else {
            // Resume when visible
            if (_enabled && _config) {
                if (_config.pixelShift?.enabled) {
                    _pixelShiftTimer = setInterval(applyPixelShift, _config.pixelShift.intervalMs);
                }
                if (_config.elementCycling?.enabled) {
                    _elementCycleTimer = setInterval(
                        cycleElements,
                        _config.elementCycling.intervalMs
                    );
                }
                if (_config.screenRefresh?.enabled) {
                    _screenRefreshTimer = setInterval(
                        performScreenRefresh,
                        _config.screenRefresh.intervalMs
                    );
                }
            }
        }
    }

    /**
     * Log helper
     */
    function log(message) {
        if (
            typeof console !== 'undefined' &&
            (global.PosterramaDebug || localStorage.getItem('posterrama_debug'))
        ) {
            console.log(`[${MODULE_NAME}] ${message}`);
        }
    }

    /**
     * Get current status
     */
    function getStatus() {
        return {
            enabled: _enabled,
            level: _config?.level,
            pixelShift: {
                active: !!_pixelShiftTimer,
                current: { ..._currentShift },
            },
            elementCycling: {
                active: !!_elementCycleTimer,
                elementsTracked: _staticElements.length,
            },
            screenRefresh: {
                active: !!_screenRefreshTimer,
            },
        };
    }

    // ========================================
    // Export
    // ========================================

    const BurnInPrevention = {
        init,
        destroy,
        getStatus,
        // Allow manual refresh trigger
        forcePixelShift: applyPixelShift,
        forceElementCycle: cycleElements,
        forceScreenRefresh: performScreenRefresh,
    };

    // Register globally
    global.PosterramaBurnInPrevention = BurnInPrevention;

    // Support module systems
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = BurnInPrevention;
    }
})(typeof window !== 'undefined' ? window : this);
