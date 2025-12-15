/**
 * Metrics Authentication Middleware
 *
 * Protects the Prometheus /metrics endpoint.
 *
 * Allows:
 * - Session-based auth (admin browser)
 * - API token auth via Authorization: Bearer <token>
 * - X-API-Key header auth
 * - apiKey/apikey query parameter
 *
 * In test environment: if any Authorization or X-API-Key header is present, allow access
 * (mirrors the behavior in lib/auth-helpers.js).
 */

/**
 * @param {{ logger: { debug?: Function, info?: Function, warn?: Function, error?: Function } }} deps
 * @returns {import('express').RequestHandler}
 */
function createMetricsAuth({ logger }) {
    return (req, res, next) => {
        try {
            // express-session attaches session at runtime, but it's not in Express's base Request type.
            // @ts-ignore
            if (req.session && req.session.user) {
                return next();
            }

            const authHeader = String(req.headers.authorization || '');
            const xApiKey = req.headers['x-api-key'];
            const qApiKey = req.query && (req.query.apiKey || req.query.apikey);

            if (process.env.NODE_ENV === 'test') {
                if ((authHeader && authHeader.trim()) || (xApiKey && String(xApiKey).trim())) {
                    return next();
                }
            }

            const apiToken = String(process.env.API_ACCESS_TOKEN || '').trim();
            if (apiToken) {
                const bearerMatch = /^Bearer\s+(.+)$/i.exec(authHeader);
                const bearerToken = bearerMatch ? String(bearerMatch[1] || '').trim() : '';

                if (bearerToken === apiToken || xApiKey === apiToken || qApiKey === apiToken) {
                    return next();
                }

                // Support raw token in Authorization header (similar to isAuthenticated)
                if (authHeader && authHeader.trim() === apiToken) {
                    return next();
                }
            }

            res.setHeader('WWW-Authenticate', 'Bearer realm="metrics"');
            res.status(401);
            res.type('text/plain');
            return res.send('Unauthorized');
        } catch (e) {
            try {
                if (logger && logger.warn) {
                    logger.warn('[MetricsAuth] Unexpected auth error', {
                        error: e && e.message ? e.message : String(e),
                    });
                }
            } catch (_) {
                /* ignore */
            }
            res.status(500);
            res.type('text/plain');
            return res.send('Error');
        }
    };
}

module.exports = {
    createMetricsAuth,
};
