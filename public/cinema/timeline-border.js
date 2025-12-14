/**
 * Timeline Border Component for Cinema Mode
 *
 * Shows a visual progress border around the screen that fills based on
 * Now Playing media playback progress.
 *
 * Only works when Now Playing is enabled and has an active session.
 *
 * Features:
 * - Gradient color effect (changes as progress increases)
 * - Border styles: solid, dashed, dotted, neon
 * - Auto color mode (ton-sur-ton from poster)
 * - Paused indicator (pulsing animation)
 *
 * @module public/cinema/timeline-border
 */

(function (global) {
    'use strict';

    const MODULE_NAME = 'TimelineBorder';

    // Default configuration
    const DEFAULTS = {
        enabled: false,
        thickness: 3, // pixels (1-10)
        colorMode: 'custom', // custom | auto
        color: '#ffffff', // border color (used when colorMode is custom)
        opacity: 0.6, // 0-1
        style: 'solid', // solid | dashed | dotted | neon
        gradient: false, // gradient color effect
        glowEnabled: false,
        glowIntensity: 10, // blur radius in px
        pausedIndicator: true, // show pulsing when paused
    };

    // Gradient colors for progress (from blue to green to yellow to red)
    const GRADIENT_COLORS = [
        { stop: 0, color: '#3498db' }, // Blue
        { stop: 25, color: '#2ecc71' }, // Green
        { stop: 50, color: '#f1c40f' }, // Yellow
        { stop: 75, color: '#e67e22' }, // Orange
        { stop: 100, color: '#e74c3c' }, // Red
    ];

    // State
    let _config = null;
    let _enabled = false;
    let _container = null;
    let _progressBorder = null;
    let _currentProgress = 0;
    let _animationFrame = null;
    let _targetProgress = 0;
    let _isPaused = false;
    let _pauseAnimationFrame = null;
    let _autoColor = null; // Color from ton-sur-ton
    let _pausedOriginalProgress = null; // Store progress when paused to restore later

    /**
     * Initialize timeline border
     * @param {object} config - Timeline border configuration
     */
    function init(config) {
        _config = { ...DEFAULTS, ...(config || {}) };

        if (!_config.enabled) {
            log('Timeline border disabled');
            return;
        }

        _enabled = true;
        _isPaused = false;
        createBorderElement();
        log('Timeline border initialized', _config);
    }

    /**
     * Get the current color based on config and progress
     * @param {number} percent - Current progress percentage
     * @returns {string} Color in hex format
     */
    function getCurrentColor(percent) {
        // Auto mode uses ton-sur-ton color from poster
        if (_config.colorMode === 'auto' && _autoColor) {
            return _autoColor;
        }

        // Gradient mode interpolates between colors based on progress
        if (_config.gradient) {
            return interpolateGradientColor(percent);
        }

        // Default: use configured color
        return _config.color || '#ffffff';
    }

    /**
     * Interpolate color from gradient based on progress
     * @param {number} percent - Progress percentage (0-100)
     * @returns {string} Interpolated color in hex
     */
    function interpolateGradientColor(percent) {
        // Find the two gradient stops to interpolate between
        let lower = GRADIENT_COLORS[0];
        let upper = GRADIENT_COLORS[GRADIENT_COLORS.length - 1];

        for (let i = 0; i < GRADIENT_COLORS.length - 1; i++) {
            if (percent >= GRADIENT_COLORS[i].stop && percent <= GRADIENT_COLORS[i + 1].stop) {
                lower = GRADIENT_COLORS[i];
                upper = GRADIENT_COLORS[i + 1];
                break;
            }
        }

        // Calculate interpolation factor
        const range = upper.stop - lower.stop;
        const factor = range > 0 ? (percent - lower.stop) / range : 0;

        // Interpolate RGB values
        const lowerRgb = hexToRgb(lower.color);
        const upperRgb = hexToRgb(upper.color);

        const r = Math.round(lowerRgb.r + (upperRgb.r - lowerRgb.r) * factor);
        const g = Math.round(lowerRgb.g + (upperRgb.g - lowerRgb.g) * factor);
        const b = Math.round(lowerRgb.b + (upperRgb.b - lowerRgb.b) * factor);

        return rgbToHex(r, g, b);
    }

    /**
     * Convert hex color to RGB object
     */
    function hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result
            ? {
                  r: parseInt(result[1], 16),
                  g: parseInt(result[2], 16),
                  b: parseInt(result[3], 16),
              }
            : { r: 255, g: 255, b: 255 };
    }

    /**
     * Convert RGB to hex color
     */
    function rgbToHex(r, g, b) {
        return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
    }

    /**
     * Get the CSS gradient string for a specific border segment
     * Each segment shows its portion of the full gradient
     * @param {string} side - Which border side (top, right, bottom, left)
     * @returns {string} CSS gradient string
     */
    function getSegmentGradient(side) {
        // Full gradient colors
        const colors = GRADIENT_COLORS.map(g => g.color);

        // Each segment covers 25% of the total progress
        // Top: 0-25% (blue → green)
        // Right: 25-50% (green → yellow)
        // Bottom: 50-75% (yellow → orange) - reversed direction
        // Left: 75-100% (orange → red) - reversed direction

        switch (side) {
            case 'top':
                // Left to right: blue → green
                return `linear-gradient(90deg, ${colors[0]}, ${colors[1]})`;
            case 'right':
                // Top to bottom: green → yellow
                return `linear-gradient(180deg, ${colors[1]}, ${colors[2]})`;
            case 'bottom':
                // Right to left: yellow → orange
                return `linear-gradient(270deg, ${colors[2]}, ${colors[3]})`;
            case 'left':
                // Bottom to top: orange → red
                return `linear-gradient(0deg, ${colors[3]}, ${colors[4]})`;
            default:
                return `linear-gradient(90deg, ${colors[0]}, ${colors[4]})`;
        }
    }

    /**
     * Get border style CSS based on config
     * @param {string} color - Current color
     * @param {string} side - Which border side (top, right, bottom, left)
     * @param {boolean} forceNoGradient - Force single color mode (used for pause state)
     * @returns {object} Style properties
     */
    function getBorderStyleProps(color, side = 'top', forceNoGradient = false) {
        const style = _config.style || 'solid';
        const thickness = _config.thickness || 3;
        const opacity = _config.opacity || 0.6;

        // Determine gradient direction based on side
        // Horizontal borders (top/bottom) use 90deg (left to right)
        // Vertical borders (left/right) use 0deg (top to bottom)
        const isVertical = side === 'left' || side === 'right';
        const gradientAngle = isVertical ? '0deg' : '90deg';

        const baseProps = {
            opacity: opacity,
        };

        // For gradient mode (unless forced off for pause state), use the segment gradient
        if (_config.gradient && !forceNoGradient) {
            const segmentGradient = getSegmentGradient(side);

            switch (style) {
                case 'dashed': {
                    // Overlay dashed pattern on top of gradient
                    const dashGradient = isVertical
                        ? `repeating-linear-gradient(0deg, transparent 0px, transparent 10px, rgba(0,0,0,0.8) 10px, rgba(0,0,0,0.8) 20px)`
                        : `repeating-linear-gradient(90deg, transparent 0px, transparent 10px, rgba(0,0,0,0.8) 10px, rgba(0,0,0,0.8) 20px)`;
                    return {
                        ...baseProps,
                        background: `${dashGradient}, ${segmentGradient}`,
                    };
                }
                case 'dotted': {
                    const dotGradient = isVertical
                        ? `repeating-linear-gradient(0deg, transparent 0px, transparent ${thickness}px, rgba(0,0,0,0.8) ${thickness}px, rgba(0,0,0,0.8) ${thickness * 2}px)`
                        : `repeating-linear-gradient(90deg, transparent 0px, transparent ${thickness}px, rgba(0,0,0,0.8) ${thickness}px, rgba(0,0,0,0.8) ${thickness * 2}px)`;
                    return {
                        ...baseProps,
                        background: `${dotGradient}, ${segmentGradient}`,
                    };
                }
                case 'neon':
                    return {
                        ...baseProps,
                        background: segmentGradient,
                        boxShadow: `0 0 ${thickness * 2}px ${GRADIENT_COLORS[2].color}, 0 0 ${thickness * 4}px ${GRADIENT_COLORS[2].color}`,
                    };
                case 'solid':
                default:
                    return {
                        ...baseProps,
                        background: segmentGradient,
                    };
            }
        }

        // Non-gradient modes (single color)
        switch (style) {
            case 'dashed':
                return {
                    ...baseProps,
                    background: `repeating-linear-gradient(${gradientAngle}, ${color} 0px, ${color} 10px, transparent 10px, transparent 20px)`,
                };
            case 'dotted':
                return {
                    ...baseProps,
                    background: `repeating-linear-gradient(${gradientAngle}, ${color} 0px, ${color} ${thickness}px, transparent ${thickness}px, transparent ${thickness * 2}px)`,
                };
            case 'neon':
                return {
                    ...baseProps,
                    backgroundColor: color,
                    boxShadow: `0 0 ${thickness * 2}px ${color}, 0 0 ${thickness * 4}px ${color}, inset 0 0 ${thickness}px rgba(255,255,255,0.5)`,
                };
            case 'solid':
            default:
                return {
                    ...baseProps,
                    backgroundColor: color,
                };
        }
    }

    /**
     * Create the border overlay element using CSS borders
     * Uses 4 separate border elements for top, right, bottom, left
     * Each one animates its width/height to show progress
     */
    function createBorderElement() {
        // Remove existing if any
        if (_container) {
            destroy();
        }

        const thickness = _config.thickness || 3;
        const color = getCurrentColor(0);

        // Create container
        _container = document.createElement('div');
        _container.id = 'timeline-border-container';
        _container.className = 'timeline-border-container';
        _container.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 9999;
        `;

        // Create 4 border segments: top, right, bottom, left
        // Progress goes clockwise starting from top-left
        const segments = ['top', 'right', 'bottom', 'left'];
        const segmentElements = {};

        segments.forEach(side => {
            // Progress element only (no background track)
            const progress = document.createElement('div');
            progress.className = `timeline-border-progress timeline-border-${side}`;
            progress.id = `timeline-progress-${side}`;

            const styleProps = getBorderStyleProps(color, side);

            let baseStyle = `
                position: absolute;
                transition: width 0.5s ease-out, height 0.5s ease-out, background-color 0.5s ease-out;
            `;

            // Apply style properties
            Object.entries(styleProps).forEach(([key, value]) => {
                const cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
                baseStyle += `${cssKey}: ${value};`;
            });

            if (side === 'top') {
                progress.style.cssText = `${baseStyle} top: 0; left: 0; width: 0%; height: ${thickness}px;`;
            } else if (side === 'right') {
                progress.style.cssText = `${baseStyle} top: 0; right: 0; width: ${thickness}px; height: 0%;`;
            } else if (side === 'bottom') {
                progress.style.cssText = `${baseStyle} bottom: 0; right: 0; width: 0%; height: ${thickness}px;`;
            } else if (side === 'left') {
                progress.style.cssText = `${baseStyle} bottom: 0; left: 0; width: ${thickness}px; height: 0%;`;
            }

            // Add glow effect if enabled (and not neon which has its own glow)
            if (_config.glowEnabled && _config.style !== 'neon') {
                const glowIntensity = _config.glowIntensity || 10;
                progress.style.boxShadow = `0 0 ${glowIntensity}px ${color}`;
            }

            _container.appendChild(progress);
            segmentElements[side] = progress;
        });

        // Store segment references
        _progressBorder = segmentElements;

        document.body.appendChild(_container);

        // Listen for resize
        window.addEventListener('resize', handleResize);

        // Initial progress
        setProgress(0);

        log('Timeline border created with CSS borders');
    }

    /**
     * Update border dimensions based on viewport (no-op for CSS version)
     */
    function updateBorderDimensions() {
        // CSS handles dimensions automatically
    }

    // applyPositionMask not needed for CSS-based borders

    /**
     * Handle window resize
     */
    function handleResize() {
        updateBorderDimensions();
        // Reapply current progress
        setProgress(_currentProgress, true);
    }

    /**
     * Set progress (0-100)
     * @param {number} percent - Progress percentage (0-100)
     * @param {boolean} immediate - Skip animation
     */
    function setProgress(percent, immediate = false) {
        if (!_enabled || !_progressBorder) return;

        _targetProgress = Math.max(0, Math.min(100, percent));

        if (immediate || _config.style === 'stepped') {
            _currentProgress = _targetProgress;
            applyProgress(_currentProgress);
        } else {
            // Smooth animation
            animateToTarget();
        }
    }

    /**
     * Animate progress to target
     */
    function animateToTarget() {
        if (_animationFrame) {
            cancelAnimationFrame(_animationFrame);
        }

        function animate() {
            const diff = _targetProgress - _currentProgress;

            if (Math.abs(diff) < 0.1) {
                _currentProgress = _targetProgress;
                applyProgress(_currentProgress);
                return;
            }

            // Ease towards target
            _currentProgress += diff * 0.1;
            applyProgress(_currentProgress);

            _animationFrame = requestAnimationFrame(animate);
        }

        _animationFrame = requestAnimationFrame(animate);
    }

    /**
     * Apply progress to CSS borders
     * Progress flows clockwise: top (0-25%), right (25-50%), bottom (50-75%), left (75-100%)
     * @param {number} percent - Progress percentage (0-100)
     */
    function applyProgress(percent) {
        if (!_progressBorder) return;

        const top = _progressBorder.top;
        const right = _progressBorder.right;
        const bottom = _progressBorder.bottom;
        const left = _progressBorder.left;

        if (!top || !right || !bottom || !left) return;

        // Calculate progress for each segment (each segment is 25%)
        // Top: 0-25% maps to 0-100% width (left to right)
        // Right: 25-50% maps to 0-100% height (top to bottom)
        // Bottom: 50-75% maps to 0-100% width (right to left)
        // Left: 75-100% maps to 0-100% height (bottom to top)

        const topProgress = Math.min(100, Math.max(0, percent * 4));
        const rightProgress = Math.min(100, Math.max(0, (percent - 25) * 4));
        const bottomProgress = Math.min(100, Math.max(0, (percent - 50) * 4));
        const leftProgress = Math.min(100, Math.max(0, (percent - 75) * 4));

        // Apply to top (width from left)
        top.style.width = `${topProgress}%`;

        // Apply to right (height from top)
        right.style.height = `${rightProgress}%`;

        // Apply to bottom (width from right, so we position it from right)
        bottom.style.width = `${bottomProgress}%`;

        // Apply to left (height from bottom, so we position it from bottom)
        left.style.height = `${leftProgress}%`;

        // Update colors only for auto color mode (gradient colors are fixed)
        if (_config.colorMode === 'auto' && !_config.gradient) {
            updateBorderColors(percent);
        }
    }

    /**
     * Update border colors based on current progress (for gradient mode)
     * @param {number} percent - Progress percentage
     */
    function updateBorderColors(percent) {
        if (!_progressBorder) return;

        const color = getCurrentColor(percent);

        // Update each side with correct gradient direction
        const sides = ['top', 'right', 'bottom', 'left'];
        sides.forEach(side => {
            const el = _progressBorder[side];
            if (!el) return;

            const styleProps = getBorderStyleProps(color, side);

            if (styleProps.backgroundColor) {
                el.style.backgroundColor = styleProps.backgroundColor;
            }
            if (styleProps.background) {
                el.style.background = styleProps.background;
            }
            if (styleProps.boxShadow) {
                el.style.boxShadow = styleProps.boxShadow;
            } else if (_config.glowEnabled && _config.style !== 'neon') {
                const glowIntensity = _config.glowIntensity || 10;
                el.style.boxShadow = `0 0 ${glowIntensity}px ${color}`;
            }
        });
    }

    /**
     * Set the auto color (from ton-sur-ton calculation)
     * @param {string} color - Color in hex format
     */
    function setAutoColor(color) {
        _autoColor = color;
        if (_enabled && _config.colorMode === 'auto') {
            updateBorderColors(_currentProgress);
        }
    }

    /**
     * Set paused state
     * @param {boolean} paused - Whether playback is paused
     */
    function setPaused(paused) {
        if (_isPaused === paused) return;
        _isPaused = paused;

        if (paused && _config.pausedIndicator) {
            startPauseAnimation();
        } else {
            stopPauseAnimation();
        }
    }

    /**
     * Start pulsing animation for paused state
     * Shows full border (all 4 sides at 100%) pulsing with current color
     */
    function startPauseAnimation() {
        if (_pauseAnimationFrame) return;

        // Store original progress to restore later
        _pausedOriginalProgress = _currentProgress;

        // Determine the pause color
        // For gradient mode: use the interpolated color at current progress
        // For other modes: use the configured color or auto color
        let pauseColor;
        if (_config.gradient) {
            pauseColor = interpolateGradientColor(_currentProgress);
        } else if (_config.colorMode === 'auto' && _autoColor) {
            pauseColor = _autoColor;
        } else {
            pauseColor = _config.color || '#ffffff';
        }

        // Expand all borders to 100% with the pause color, keeping the style
        if (_progressBorder) {
            const sides = ['top', 'right', 'bottom', 'left'];
            const thickness = _config.thickness || 3;
            log(`Pause: expanding all ${sides.length} borders to 100%, color: ${pauseColor}`);

            sides.forEach(side => {
                const el = _progressBorder[side];
                if (!el) {
                    log(`Pause: border element for ${side} not found!`);
                    return;
                }

                // Get the style props for this side
                const styleProps = getBorderStyleProps(pauseColor, side, true);

                // Build complete inline style for each border at 100%
                // Positions must match the original clockwise flow:
                // top: left→right, right: top→bottom, bottom: right→left, left: bottom→top
                let fullStyle = `
                    position: absolute;
                    transition: none;
                    opacity: ${styleProps.opacity || 0.6};
                `;

                // Add background
                if (styleProps.background) {
                    fullStyle += `background: ${styleProps.background};`;
                } else if (styleProps.backgroundColor) {
                    fullStyle += `background-color: ${styleProps.backgroundColor};`;
                }

                // Add box shadow if present
                if (styleProps.boxShadow) {
                    fullStyle += `box-shadow: ${styleProps.boxShadow};`;
                } else if (_config.glowEnabled) {
                    const glowIntensity = _config.glowIntensity || 10;
                    fullStyle += `box-shadow: 0 0 ${glowIntensity}px ${pauseColor};`;
                }

                // Position and size based on side - ALL at 100%
                // Keep original anchor positions for clockwise animation
                if (side === 'top') {
                    fullStyle += `top: 0; left: 0; width: 100%; height: ${thickness}px;`;
                } else if (side === 'right') {
                    fullStyle += `top: 0; right: 0; width: ${thickness}px; height: 100%;`;
                } else if (side === 'bottom') {
                    fullStyle += `bottom: 0; right: 0; width: 100%; height: ${thickness}px;`;
                } else if (side === 'left') {
                    fullStyle += `bottom: 0; left: 0; width: ${thickness}px; height: 100%;`;
                }

                // Apply the complete style
                el.style.cssText = fullStyle;
                log(`Pause: ${side} set to 100% with full style reset`);
            });
        } else {
            log('Pause: _progressBorder is null/undefined!');
        }

        let opacity = _config.opacity || 0.6;
        let direction = -1;
        const minOpacity = 0.15;
        const maxOpacity = _config.opacity || 0.6;
        // Slower, more gentle pulsing (was 0.02)
        const step = 0.008;

        function pulse() {
            opacity += step * direction;

            if (opacity <= minOpacity) {
                opacity = minOpacity;
                direction = 1;
            } else if (opacity >= maxOpacity) {
                opacity = maxOpacity;
                direction = -1;
            }

            if (_progressBorder) {
                Object.values(_progressBorder).forEach(el => {
                    el.style.opacity = String(opacity);
                });
            }

            if (_isPaused && _config.pausedIndicator) {
                _pauseAnimationFrame = requestAnimationFrame(pulse);
            }
        }

        _pauseAnimationFrame = requestAnimationFrame(pulse);
        log('Pause animation started with full border');
    }

    /**
     * Stop pulsing animation and restore progress state
     */
    function stopPauseAnimation() {
        if (_pauseAnimationFrame) {
            cancelAnimationFrame(_pauseAnimationFrame);
            _pauseAnimationFrame = null;
        }

        // Restore original progress and colors
        if (typeof _pausedOriginalProgress === 'number' && _progressBorder) {
            const thickness = _config.thickness || 3;
            const color = getCurrentColor(_pausedOriginalProgress);
            const opacity = _config.opacity || 0.6;

            // Rebuild each border element with correct positioning and style
            const sides = ['top', 'right', 'bottom', 'left'];
            sides.forEach(side => {
                const el = _progressBorder[side];
                if (!el) return;

                const styleProps = getBorderStyleProps(color, side);

                // Build the base style with transition re-enabled
                let baseStyle = `
                    position: absolute;
                    transition: width 0.5s ease-out, height 0.5s ease-out, background-color 0.5s ease-out;
                    opacity: ${opacity};
                `;

                // Add background
                if (styleProps.background) {
                    baseStyle += `background: ${styleProps.background};`;
                } else if (styleProps.backgroundColor) {
                    baseStyle += `background-color: ${styleProps.backgroundColor};`;
                }

                // Add box shadow
                if (styleProps.boxShadow) {
                    baseStyle += `box-shadow: ${styleProps.boxShadow};`;
                } else if (_config.glowEnabled && _config.style !== 'neon') {
                    const glowIntensity = _config.glowIntensity || 10;
                    baseStyle += `box-shadow: 0 0 ${glowIntensity}px ${color};`;
                }

                // Restore original positions (progress will be applied by applyProgress)
                if (side === 'top') {
                    baseStyle += `top: 0; left: 0; width: 0%; height: ${thickness}px;`;
                } else if (side === 'right') {
                    baseStyle += `top: 0; right: 0; width: ${thickness}px; height: 0%;`;
                } else if (side === 'bottom') {
                    baseStyle += `bottom: 0; right: 0; width: 0%; height: ${thickness}px;`;
                } else if (side === 'left') {
                    baseStyle += `bottom: 0; left: 0; width: ${thickness}px; height: 0%;`;
                }

                el.style.cssText = baseStyle;
            });

            // Now apply the actual progress
            applyProgress(_pausedOriginalProgress);
            _pausedOriginalProgress = null;
        }

        log('Pause animation stopped');
    }

    /**
     * Update from Plex/Jellyfin session data
     * @param {object} session - Session object with viewOffset, duration, and state
     */
    function updateFromSession(session) {
        if (!_enabled) return;

        if (!session || !session.duration) {
            setProgress(0);
            setPaused(false);
            return;
        }

        const viewOffset = session.viewOffset || 0;
        const duration = session.duration;
        const percent = Math.round((viewOffset / duration) * 100);

        setProgress(percent);

        // Check if paused
        // - Plex processed sessions: session.playerState === 'paused'
        // - Plex raw sessions: session.Player?.state === 'paused'
        // - Jellyfin: session.IsPaused === true or session.PlayState?.IsPaused === true
        const isPaused =
            session.playerState === 'paused' ||
            session.state === 'paused' ||
            session.Player?.state === 'paused' ||
            session.IsPaused === true ||
            session.PlayState?.IsPaused === true;

        setPaused(isPaused);
    }

    /**
     * Show the timeline border
     */
    function show() {
        if (_container) {
            _container.style.opacity = '1';
            _container.style.pointerEvents = 'none';
        }
    }

    /**
     * Hide the timeline border
     */
    function hide() {
        if (_container) {
            _container.style.opacity = '0';
        }
    }

    /**
     * Destroy and cleanup
     */
    function destroy() {
        _enabled = false;
        _isPaused = false;

        if (_animationFrame) {
            cancelAnimationFrame(_animationFrame);
            _animationFrame = null;
        }

        stopPauseAnimation();

        window.removeEventListener('resize', handleResize);

        if (_container && _container.parentNode) {
            _container.parentNode.removeChild(_container);
        }

        _container = null;
        _progressBorder = null;
        _currentProgress = 0;
        _targetProgress = 0;
        _autoColor = null;
        _pausedOriginalProgress = null;

        log('Timeline border destroyed');
    }

    /**
     * Get current status
     * @returns {object} Status object
     */
    function getStatus() {
        return {
            enabled: _enabled,
            config: _config,
            currentProgress: _currentProgress,
            targetProgress: _targetProgress,
        };
    }

    /**
     * Update configuration
     * @param {object} newConfig - New configuration
     */
    function updateConfig(newConfig) {
        const wasEnabled = _enabled;
        destroy();
        init({ ..._config, ...newConfig });

        if (wasEnabled && _enabled) {
            setProgress(_currentProgress);
        }
    }

    /**
     * Log helper
     */
    function log(...args) {
        if (typeof console !== 'undefined') {
            console.log(`[${MODULE_NAME}]`, ...args);
        }
    }

    // Expose API
    const api = {
        init,
        destroy,
        setProgress,
        updateFromSession,
        setAutoColor,
        setPaused,
        show,
        hide,
        getStatus,
        updateConfig,
    };

    // Export
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        global.PosterramaTimelineBorder = api;
    }
})(typeof window !== 'undefined' ? window : this);
