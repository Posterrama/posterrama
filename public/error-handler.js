/**
 * Global Error Handler
 *
 * Catches uncaught errors and unhandled promise rejections,
 * logs them to the console and optionally sends them to the server
 * for telemetry/monitoring.
 */

const ERROR_LOG_ENDPOINT = '/api/telemetry/error';
const MAX_ERROR_LENGTH = 1000;
const MAX_ERRORS_PER_SESSION = 50;

let errorCount = 0;

/**
 * Sanitize error data for logging
 */
function sanitizeError(error) {
    const sanitized = {
        message: String(error.message || error).substring(0, MAX_ERROR_LENGTH),
        type: error.name || 'Error',
        timestamp: new Date().toISOString(),
        url: window.location.href,
        userAgent: navigator.userAgent,
    };

    // Add stack trace if available
    if (error.stack) {
        sanitized.stack = String(error.stack).substring(0, MAX_ERROR_LENGTH);
    }

    return sanitized;
}

/**
 * Send error to server telemetry endpoint
 */
async function sendErrorToServer(errorData) {
    // Respect rate limit
    if (errorCount >= MAX_ERRORS_PER_SESSION) {
        console.warn('[ErrorHandler] Max errors per session reached, not sending');
        return;
    }

    errorCount++;

    try {
        await fetch(ERROR_LOG_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(errorData),
            // Don't wait for response, fire and forget
            keepalive: true,
        });
    } catch (e) {
        // Silently fail - don't create error loop
        console.debug('[ErrorHandler] Failed to send error to server:', e.message);
    }
}

/**
 * Handle uncaught JavaScript errors
 */
function handleError(event) {
    const errorData = {
        ...sanitizeError(event.error || new Error(event.message)),
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
    };

    console.error('[ErrorHandler] Uncaught error:', errorData);

    // Send to server for logging
    sendErrorToServer(errorData);

    // Allow default error handling
    return false;
}

/**
 * Handle unhandled promise rejections
 */
function handleUnhandledRejection(event) {
    const errorData = {
        ...sanitizeError(event.reason || new Error('Unhandled Promise Rejection')),
        promiseRejection: true,
    };

    console.error('[ErrorHandler] Unhandled promise rejection:', errorData);

    // Send to server for logging
    sendErrorToServer(errorData);

    // Prevent default "Uncaught (in promise)" message
    event.preventDefault();
}

/**
 * Initialize global error handlers
 */
export function initErrorHandlers() {
    // Catch uncaught errors
    window.addEventListener('error', handleError);

    // Catch unhandled promise rejections
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    console.log('[ErrorHandler] Global error handlers initialized');
}

/**
 * Manually log an error (useful for caught errors you want to report)
 */
export function logError(error, context = {}) {
    const errorData = {
        ...sanitizeError(error),
        ...context,
        manual: true,
    };

    console.error('[ErrorHandler] Manual error log:', errorData);
    sendErrorToServer(errorData);
}

// Auto-initialize when module is imported
initErrorHandlers();

// Auto-loader for display pages (screensaver/wallart/cinema)
// Use a gated dynamic import so admin pages never pay the cost or risk.
async function maybeInitAutoLoader() {
    try {
        if (window.__POSTERRAMA_DISABLE_AUTO_LOADER__ === true) return;

        try {
            const params = new URLSearchParams(window.location.search || '');
            if (params.get('disableAutoLoader') === '1') return;
        } catch (_) {
            // ignore
        }

        try {
            if (localStorage.getItem('POSTERRAMA_DISABLE_AUTO_LOADER') === '1') return;
        } catch (_) {
            // ignore
        }

        const mode = document.body?.dataset?.mode;
        if (!mode) return;
        if (!['screensaver', 'wallart', 'cinema'].includes(mode)) return;

        const mod = await import('./ui/auto-loader.js');
        if (typeof mod.initAutoLoader === 'function') {
            mod.initAutoLoader();
        }
    } catch (_) {
        // Never let loader logic break the app
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        maybeInitAutoLoader();
    });
} else {
    maybeInitAutoLoader();
}
