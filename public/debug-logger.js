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

    // Log function
    window.debugLog = function (message, data) {
        const timestamp = new Date().toISOString();
        const entry = {
            time: timestamp,
            message: message,
            data: data,
            url: window.location.href,
        };

        // Log to console
        console.log(`[DEBUG ${timestamp}]`, message, data || '');

        // Persist to localStorage
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

    // Auto-log page load
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
        '[DEBUG] Persistent logger ready. Use debugLogView() to see all logs, debugLogClear() to clear.'
    );
})();
