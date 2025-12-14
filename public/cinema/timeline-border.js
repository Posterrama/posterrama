/**
 * Timeline Border Component for Cinema Mode
 *
 * Shows a visual progress border around the screen that fills based on
 * Now Playing media playback progress.
 *
 * Only works when Now Playing is enabled and has an active session.
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
        color: '#ffffff', // border color
        opacity: 0.6, // 0-1
        glowEnabled: false,
        glowColor: '#ffffff',
        glowIntensity: 10, // blur radius in px
        position: 'all', // all | top | bottom | left | right
        style: 'smooth', // smooth | stepped
    };

    // State
    let _config = null;
    let _enabled = false;
    let _container = null;
    let _progressBorder = null;
    let _currentProgress = 0;
    let _animationFrame = null;
    let _targetProgress = 0;

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
        createBorderElement();
        log('Timeline border initialized', _config);
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
        const color = _config.color || '#ffffff';
        const opacity = _config.opacity || 0.6;

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

            const baseStyle = `
                position: absolute;
                background-color: ${color};
                opacity: ${opacity};
                transition: width 0.5s ease-out, height 0.5s ease-out;
            `;

            if (side === 'top') {
                progress.style.cssText = `${baseStyle} top: 0; left: 0; width: 0%; height: ${thickness}px;`;
            } else if (side === 'right') {
                progress.style.cssText = `${baseStyle} top: 0; right: 0; width: ${thickness}px; height: 0%;`;
            } else if (side === 'bottom') {
                progress.style.cssText = `${baseStyle} bottom: 0; right: 0; width: 0%; height: ${thickness}px;`;
            } else if (side === 'left') {
                progress.style.cssText = `${baseStyle} bottom: 0; left: 0; width: ${thickness}px; height: 0%;`;
            }

            // Add glow effect if enabled
            if (_config.glowEnabled) {
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
    }

    /**
     * Update from Plex session data
     * @param {object} session - Plex session object with viewOffset and duration
     */
    function updateFromSession(session) {
        if (!_enabled) return;

        if (!session || !session.duration) {
            setProgress(0);
            return;
        }

        const viewOffset = session.viewOffset || 0;
        const duration = session.duration;
        const percent = Math.round((viewOffset / duration) * 100);

        setProgress(percent);
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

        if (_animationFrame) {
            cancelAnimationFrame(_animationFrame);
            _animationFrame = null;
        }

        window.removeEventListener('resize', handleResize);

        if (_container && _container.parentNode) {
            _container.parentNode.removeChild(_container);
        }

        _container = null;
        _progressBorder = null;
        _currentProgress = 0;
        _targetProgress = 0;

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
