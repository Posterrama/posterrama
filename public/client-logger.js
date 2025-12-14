/**
 * Client-side Logger
 * Provides controlled logging that can be toggled for debugging
 * Usage: logger.debug('message'), logger.info('message'), logger.error('message')
 */

class ClientLogger {
    constructor() {
        // Check if debugging is enabled via config or localStorage
        this.debugEnabled = this.isDebugEnabled();

        // Keep legacy/global debug flag in sync so older checks still work
        try {
            if (typeof window !== 'undefined') {
                window.POSTERRAMA_DEBUG = !!this.debugEnabled;
            }
        } catch (_) {
            /* noop */
        }

        // Store original console methods
        this.originalConsole = {
            log: console.log,
            debug: console.debug,
            info: console.info,
            warn: console.warn,
            error: console.error,
        };

        // Global in-memory log history so the admin can request "recent" logs
        // (best-effort, bounded).
        try {
            if (typeof window !== 'undefined') {
                if (!Array.isArray(window.__posterramaClientLogHistory)) {
                    window.__posterramaClientLogHistory = [];
                }
            }
        } catch (_) {
            /* noop */
        }
    }

    _pushRemote(level, args) {
        // level: log|debug|info|warn|error
        try {
            if (typeof window === 'undefined') return;
            const t = Date.now();

            // Store bounded history (raw args) so a remote viewer can replay.
            try {
                const hist = window.__posterramaClientLogHistory;
                if (Array.isArray(hist)) {
                    hist.push({ t, level, args: Array.from(args || []) });
                    const MAX = 500;
                    if (hist.length > MAX) hist.splice(0, hist.length - MAX);
                }
            } catch (_) {
                /* noop */
            }

            // Optional sink installed by device-mgmt.js for remote log streaming.
            try {
                const sink = window.__posterramaRemoteLogSink;
                if (typeof sink === 'function') sink(level, args, t);
            } catch (_) {
                /* noop */
            }
        } catch (_) {
            /* noop */
        }
    }

    isDebugEnabled() {
        // Check localStorage first (for manual debugging)
        if (localStorage.getItem('posterrama_debug') === 'true') {
            return true;
        }

        // Check if defaults.DEBUG is available (from server config)
        if (typeof defaults !== 'undefined' && defaults.DEBUG) {
            return true;
        }

        // Check URL parameter for quick debugging
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('debug') === 'true') {
            return true;
        }

        return false;
    }

    debug(...args) {
        if (this.debugEnabled) {
            this._pushRemote('debug', args);
            this.originalConsole.log('[DEBUG]', ...args);
        }
    }

    info(...args) {
        if (this.debugEnabled) {
            this._pushRemote('info', args);
            this.originalConsole.info('[INFO]', ...args);
        }
    }

    warn(...args) {
        if (this.debugEnabled) {
            this._pushRemote('warn', args);
            this.originalConsole.warn('[WARN]', ...args);
        }
    }

    error(...args) {
        // Errors are always logged
        this._pushRemote('error', args);
        this.originalConsole.error('[ERROR]', ...args);
    }

    // Method to enable/disable debugging at runtime
    setDebug(enabled) {
        this.debugEnabled = enabled;
        localStorage.setItem('posterrama_debug', enabled.toString());
        this.originalConsole.log('Debug logging', enabled ? 'enabled' : 'disabled');
        // Sync legacy/global flag for compatibility
        try {
            if (typeof window !== 'undefined') {
                window.POSTERRAMA_DEBUG = !!enabled;
            }
        } catch (_) {
            /* noop */
        }
    }

    // Method to sync with defaults.DEBUG (called when config changes)
    syncWithDefaults() {
        if (typeof defaults !== 'undefined') {
            const wasEnabled = this.debugEnabled;
            this.debugEnabled = this.isDebugEnabled();

            if (wasEnabled !== this.debugEnabled) {
                this.originalConsole.log(
                    'Debug logging synced with admin setting:',
                    this.debugEnabled ? 'enabled' : 'disabled'
                );
            }
            // Ensure legacy/global flag mirrors current state
            try {
                if (typeof window !== 'undefined') {
                    window.POSTERRAMA_DEBUG = !!this.debugEnabled;
                }
            } catch (_) {
                /* noop */
            }
        }
    }

    // Get current debug status
    isDebug() {
        return this.debugEnabled;
    }
}

// Create global logger instance
window.logger = new ClientLogger();

// Listen for config changes to sync debug setting
if (typeof document !== 'undefined') {
    document.addEventListener('configSaved', () => {
        if (window.logger) {
            window.logger.syncWithDefaults();
        }
    });
}

// Add convenience methods for enabling/disabling debug
window.enableDebug = () => window.logger.setDebug(true);
window.disableDebug = () => window.logger.setDebug(false);

// Log current debug status on load
if (window.logger.isDebug()) {
    window.logger.debug('Client-side debugging enabled');
}
