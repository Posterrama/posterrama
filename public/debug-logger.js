/**
 * Persistent Debug Logger
 * Logs persist across page reloads in localStorage
 * Usage: window.debugLog('message', data)
 */
(function () {
    const MAX_LOGS = 100;
    const STORAGE_KEY = 'posterrama_debug_logs';

    // Initialize log storage
    function getLogs() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            return stored ? JSON.parse(stored) : [];
        } catch (_) {
            return [];
        }
    }

    function saveLogs(logs) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(logs.slice(-MAX_LOGS)));
        } catch (_) {
            // Storage full or disabled
        }
    }

    // Check if debug mode is enabled
    function isDebugEnabled() {
        // Check URL parameter ?debug=true
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('debug') === 'true') return true;

        // Check localStorage flag
        try {
            return localStorage.getItem('posterrama_debug_enabled') === 'true';
        } catch (_) {
            return false;
        }
    }

    // Enable/disable debug logging
    window.enableDebug = function () {
        try {
            localStorage.setItem('posterrama_debug_enabled', 'true');
            console.log('[DEBUG] Debug logging enabled. Reload page to see debug logs.');
        } catch (_) {
            console.warn('[DEBUG] Could not enable debug mode (localStorage unavailable)');
        }
    };

    window.disableDebug = function () {
        try {
            localStorage.removeItem('posterrama_debug_enabled');
            console.log('[DEBUG] Debug logging disabled.');
        } catch (_) {}
    };

    // Log function - only logs to console if debug is enabled
    window.debugLog = function (message, data) {
        const timestamp = new Date().toISOString();
        const entry = {
            time: timestamp,
            message: message,
            data: data,
            url: window.location.href,
        };

        // Only log to console if debug is enabled
        if (isDebugEnabled()) {
            console.log(`[DEBUG ${timestamp}]`, message, data || '');
        }

        // Always persist to localStorage (for later viewing with debugLogView)
        const logs = getLogs();
        logs.push(entry);
        saveLogs(logs);
    };

    // View all logs
    window.debugLogView = function () {
        const logs = getLogs();
        console.table(
            logs.map(l => ({
                time: l.time,
                message: l.message,
                url: l.url,
            }))
        );
        return logs;
    };

    // Clear logs
    window.debugLogClear = function () {
        localStorage.removeItem(STORAGE_KEY);
        console.log('[DEBUG] Logs cleared');
    };

    // Auto-log page load (only if debug enabled)
    if (isDebugEnabled()) {
        window.debugLog('PAGE_LOAD', {
            pathname: window.location.pathname,
            search: window.location.search,
            referrer: document.referrer,
        });

        // Track uncaught errors that might cause reloads
        window.addEventListener('error', event => {
            window.debugLog('UNCAUGHT_ERROR', {
                message: event.message,
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno,
                error: event.error?.stack || event.error?.toString(),
            });
        });

        // Track unhandled promise rejections
        window.addEventListener('unhandledrejection', event => {
            window.debugLog('UNHANDLED_REJECTION', {
                reason: event.reason?.toString() || event.reason,
                stack: event.reason?.stack,
            });
        });

        console.log(
            '[DEBUG] Debug mode enabled. Use debugLogView() to see all logs, debugLogClear() to clear, disableDebug() to turn off.'
        );
    }
})();
