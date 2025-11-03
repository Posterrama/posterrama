/**
 * Frontend Pages Routes
 * Serves HTML pages for admin panel and display modes with asset versioning
 */

const express = require('express');
const fs = require('fs');
const path = require('path');

/**
 * Create frontend pages router
 * @param {Object} deps - Dependencies
 * @param {Function} deps.isAdminSetup - Check if admin is set up
 * @param {Function} deps.isAuthenticated - Authentication middleware
 * @param {Function} deps.getAssetVersions - Get asset version map
 * @param {string} deps.ASSET_VERSION - Fallback version string
 * @param {Object} deps.logger - Logger instance
 * @param {string} deps.publicDir - Public directory path
 * @returns {express.Router} Configured router
 */
module.exports = function createFrontendPagesRouter({
    isAdminSetup,
    isAuthenticated,
    getAssetVersions,
    ASSET_VERSION,
    logger,
    publicDir,
}) {
    const router = express.Router();

    /**
     * @swagger
     * /setup.html:
     *   get:
     *     summary: Redirect to admin setup
     *     description: Redirects legacy setup.html requests to the unified admin setup route
     *     tags: ['Frontend']
     *     responses:
     *       302:
     *         description: Redirect to /admin/setup
     */
    router.get('/setup.html', (req, res) => {
        // Preserve any query string (e.g., ?complete=1) so the setup completion logic can run
        const originalUrl = req.originalUrl || req.url || '/setup.html';
        const queryIndex = originalUrl.indexOf('?');
        const query = queryIndex !== -1 ? originalUrl.substring(queryIndex) : '';
        res.redirect(`/admin/setup${query}`);
    });

    /**
     * @swagger
     * /login.html:
     *   get:
     *     summary: Redirect to admin login
     *     description: Redirects legacy login.html requests to the unified admin login route
     *     tags: ['Frontend']
     *     responses:
     *       302:
     *         description: Redirect to /admin/login
     */
    router.get('/login.html', (req, res) => {
        res.redirect('/admin/login');
    });

    /**
     * @swagger
     * /2fa-verify.html:
     *   get:
     *     summary: Serve 2FA verification page or redirect
     *     description: >
     *       Serves the 2FA verification page if user is in an active 2FA flow,
     *       otherwise redirects to login page for security.
     *     tags: ['Frontend']
     *     responses:
     *       200:
     *         description: 2FA verification page HTML
     *         content:
     *           text/html:
     *             schema:
     *               type: string
     *       302:
     *         description: Redirect to /admin/login if not in 2FA flow
     */
    router.get('/2fa-verify.html', (req, res) => {
        // Only allow access to 2FA page if user is in the middle of 2FA verification
        if (req.session && req.session.tfa_required) {
            res.sendFile(path.join(publicDir, '2fa-verify.html'));
        } else {
            res.redirect('/admin/login');
        }
    });

    /**
     * @swagger
     * /admin.css:
     *   get:
     *     summary: Serve admin CSS with cache busting
     *     description: Serves the admin panel CSS file with no-cache headers to ensure latest version is always loaded
     *     tags: ['Frontend']
     *     responses:
     *       200:
     *         description: Admin CSS file
     *         content:
     *           text/css:
     *             schema:
     *               type: string
     */
    router.get('/admin.css', (req, res) => {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.sendFile(path.join(publicDir, 'admin.css'));
    });

    /**
     * @swagger
     * /admin.js:
     *   get:
     *     summary: Serve admin JavaScript with cache busting
     *     description: Serves the admin panel JavaScript file with no-cache headers to ensure latest version is always loaded
     *     tags: ['Frontend']
     *     responses:
     *       200:
     *         description: Admin JavaScript file
     *         content:
     *           application/javascript:
     *             schema:
     *               type: string
     */
    router.get('/admin.js', (req, res) => {
        // Aggressive cache-busting for admin.js to ensure users always get latest version
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Last-Modified', new Date().toUTCString());
        res.setHeader('ETag', `"${Date.now()}"`);
        res.sendFile(path.join(publicDir, 'admin.js'));
    });

    /**
     * @swagger
     * /logs.html:
     *   get:
     *     summary: Redirect to admin logs
     *     description: Redirects logs.html requests to unified admin logs route (requires authentication)
     *     tags: ['Frontend']
     *     responses:
     *       302:
     *         description: Redirect to /admin/logs
     */
    router.get('/logs.html', isAuthenticated, (req, res) => {
        // Redirect to admin/logs route instead
        res.redirect('/admin/logs');
    });

    /**
     * @swagger
     * /preview:
     *   get:
     *     summary: Preview page
     *     description: Redirects to display mode with preview flag
     *     tags: ['Frontend']
     *     parameters:
     *       - in: query
     *         name: mode
     *         schema:
     *           type: string
     *           enum: [screensaver, cinema, wallart]
     *         description: Display mode to preview
     *     responses:
     *       302:
     *         description: Redirect to display page with preview flag
     */
    router.get('/preview', (req, res) => {
        const mode = req.query.mode || 'screensaver';
        let targetPath = '/screensaver';
        if (mode === 'cinema') targetPath = '/cinema';
        else if (mode === 'wallart') targetPath = '/wallart';

        res.redirect(`${targetPath}?preview=1`);
    });

    /**
     * @swagger
     * /admin:
     *   get:
     *     summary: Admin panel homepage
     *     description: Serves admin panel with auto-register support and asset versioning
     *     tags: ['Admin']
     *     responses:
     *       200:
     *         description: Admin panel HTML
     *       302:
     *         description: Redirect to setup or login
     */
    router.get(['/admin', '/admin.html'], (req, res, next) => {
        // Check for auto-register parameters from QR code
        const autoRegister = req.query['auto-register'];
        const deviceId = req.query['device-id'];
        const deviceName = req.query['device-name'];

        if (autoRegister === 'true' && deviceId) {
            logger.info(
                `[Auto-Register] QR code scan detected: device-id=${deviceId}, device-name=${deviceName}`
            );

            req.session.pendingAutoRegister = {
                deviceId,
                deviceName,
                timestamp: Date.now(),
            };

            if (req.session.user) {
                logger.info(
                    `[Auto-Register] User authenticated, serving admin panel with auto-register parameters`
                );
            } else {
                logger.info(`[Auto-Register] User not authenticated, redirecting to login`);
                return res.redirect('/admin/login');
            }
        }

        if (!autoRegister && !req.session.user) {
            return res.redirect('/admin/login');
        }

        // Cache-busting for HTML
        try {
            const params = new URLSearchParams(req.query || {});
            if (!params.has('v')) {
                const v = Math.floor(Date.now() / 1000).toString(36);
                params.set('v', v);
                const qs = params.toString();
                // Sanitize path to prevent open redirects - only allow relative paths
                const safePath = req.path.startsWith('/') ? req.path : '/' + req.path;
                return res.redirect(`${safePath}?${qs}`);
            }
        } catch (_) {
            /* non-fatal */
        }

        if (!isAdminSetup()) {
            return res.redirect('/admin/setup');
        }

        isAuthenticated(req, res, () => {
            const filePath = path.join(publicDir, 'admin.html');
            fs.readFile(filePath, 'utf8', (err, contents) => {
                if (err) return next(err);

                const versions = getAssetVersions(path.dirname(publicDir));
                const stamped = contents
                    .replace(
                        /admin\.css\?v=[^"&\s]+/g,
                        `admin.css?v=${versions['admin.css'] || ASSET_VERSION}`
                    )
                    .replace(
                        /admin\.js\?v=[^"&\s]+/g,
                        `admin.js?v=${versions['admin.js'] || ASSET_VERSION}`
                    )
                    .replace(
                        /admin-utils\.js\?v=[^"&\s]+/g,
                        `admin-utils.js?v=${versions['admin-utils.js'] || ASSET_VERSION}`
                    )
                    .replace(
                        /\/client-logger\.js(\?v=[^"'\s>]+)?/g,
                        `/client-logger.js?v=${versions['client-logger.js'] || ASSET_VERSION}`
                    );

                res.setHeader('Cache-Control', 'no-cache');
                res.send(stamped);
            });
        });
    });

    /**
     * @swagger
     * /:
     *   get:
     *     summary: Main index/landing page
     *     description: Serves the landing page with configurable redirect behavior
     *     tags: ['Frontend']
     *     responses:
     *       200:
     *         description: Landing page HTML
     *       302:
     *         description: Redirect to display mode (if configured)
     */
    router.get(['/', '/index.html'], (req, res, next) => {
        // Configurable root redirect
        try {
            let cfg = null;
            try {
                const rawCfg = fs.readFileSync(
                    path.join(path.dirname(publicDir), 'config.json'),
                    'utf8'
                );
                cfg = JSON.parse(rawCfg);
            } catch (_) {
                cfg = null;
            }
            const rr = cfg?.rootRoute || {};
            const behavior = rr.behavior || 'landing';
            const bypassParam = rr.bypassParam || 'landing';
            const wantsBypass = bypassParam && typeof req.query?.[bypassParam] !== 'undefined';

            if (behavior === 'redirect' && !wantsBypass) {
                let mode = rr.defaultMode;
                if (!mode) {
                    const ds = cfg || {};
                    mode =
                        (ds.cinemaMode && 'cinema') ||
                        (ds.wallartMode && (ds.wallartMode.enabled ? 'wallart' : null)) ||
                        'screensaver';
                }
                mode = mode || 'screensaver';
                let targetPath = '/screensaver';
                if (mode === 'wallart') targetPath = '/wallart';
                else if (mode === 'cinema') targetPath = '/cinema';

                const xfPrefix = req.headers['x-forwarded-prefix'] || '';
                const basePath =
                    xfPrefix && xfPrefix !== '/' ? String(xfPrefix).replace(/\/$/, '') : '';
                const location = `${basePath}${targetPath}`;
                const status = Number(rr.statusCode) === 307 ? 307 : 302;
                res.setHeader('Cache-Control', 'no-store');
                res.setHeader('Pragma', 'no-cache');
                res.setHeader('Expires', '0');
                return res.redirect(status, location);
            }
        } catch (e) {
            /* fall through to landing */
        }

        // Log device access (deduplicated)
        const isAdminAccess =
            req.headers.referer?.includes('/admin') ||
            req.headers.referer?.includes('/logs.html') ||
            req.deviceBypass;

        if (!isAdminAccess) {
            const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip;
            const userAgent = req.headers['user-agent'] || 'Unknown';
            const deviceKey = `${ip}|${userAgent.substring(0, 50)}`;

            if (!global.deviceAccessLog)
                global.deviceAccessLog = { data: new Map(), lastReset: Date.now() };
            const now = Date.now();
            if (now - global.deviceAccessLog.lastReset > 3600000) {
                global.deviceAccessLog.data.clear();
                global.deviceAccessLog.lastReset = now;
            }

            const lastSeen = global.deviceAccessLog.data.get(deviceKey);
            if (!lastSeen) {
                logger.info(
                    `[Device] Display access: ${ip} (${userAgent.substring(0, 50)}) - ${req.url}`,
                    {
                        ip,
                        userAgent: userAgent.substring(0, 100),
                        deviceKey: deviceKey.substring(0, 50),
                        bypass: false,
                        url: req.url,
                        timestamp: new Date().toISOString(),
                    }
                );
                global.deviceAccessLog.data.set(deviceKey, now);
            }
        }

        const filePath = path.join(publicDir, 'index.html');
        fs.readFile(filePath, 'utf8', (err, contents) => {
            if (err) return next(err);

            const versions = getAssetVersions(path.dirname(publicDir));
            const stamped = contents
                .replace(
                    /style\.css\?v=[^"&\s]+/g,
                    `style.css?v=${versions['style.css'] || ASSET_VERSION}`
                )
                .replace(
                    /\/wallart\/wallart\.css(\?v=[^"'\s>]+)?/g,
                    `/wallart/wallart.css?v=${versions['wallart/wallart.css'] || ASSET_VERSION}`
                )
                .replace(
                    /device-mgmt\.js\?v=[^"&\s]+/g,
                    `device-mgmt.js?v=${versions['device-mgmt.js'] || ASSET_VERSION}`
                )
                .replace(
                    /lazy-loading\.js\?v=[^"&\s]+/g,
                    `lazy-loading.js?v=${versions['lazy-loading.js'] || ASSET_VERSION}`
                )
                .replace(
                    /\/client-logger\.js(\?v=[^"'\s>]+)?/g,
                    `/client-logger.js?v=${versions['client-logger.js'] || ASSET_VERSION}`
                )
                .replace(
                    /\/manifest\.json(\?v=[^"'\s>]+)?/g,
                    `/manifest.json?v=${versions['manifest.json'] || ASSET_VERSION}`
                )
                .replace(
                    /\/sw\.js(\?v=[^"'\s>]+)?/g,
                    `/sw.js?v=${versions['sw.js'] || ASSET_VERSION}`
                );

            res.setHeader('Cache-Control', 'no-cache');
            res.send(stamped);
        });
    });

    /**
     * @swagger
     * /cinema:
     *   get:
     *     summary: Cinema display page
     *     description: Serves cinema mode HTML with asset versioning
     *     tags: ['Frontend']
     *     responses:
     *       200:
     *         description: Cinema display HTML
     */
    router.get(['/cinema', '/cinema.html'], (req, res, next) => {
        const filePath = path.join(publicDir, 'cinema.html');
        fs.readFile(filePath, 'utf8', (err, contents) => {
            if (err) return next(err);

            const versions = getAssetVersions(path.dirname(publicDir));
            const stamped = contents
                .replace(
                    /cinema\.css\?v=[^"&\s]+/g,
                    `cinema.css?v=${versions['cinema.css'] || ASSET_VERSION}`
                )
                .replace(
                    /cinema\.js\?v=[^"&\s]+/g,
                    `cinema.js?v=${versions['cinema.js'] || ASSET_VERSION}`
                )
                .replace(
                    /device-mgmt\.js\?v=[^"&\s]+/g,
                    `device-mgmt.js?v=${versions['device-mgmt.js'] || ASSET_VERSION}`
                )
                .replace(
                    /lazy-loading\.js\?v=[^"&\s]+/g,
                    `lazy-loading.js?v=${versions['lazy-loading.js'] || ASSET_VERSION}`
                )
                .replace(
                    /\/client-logger\.js(\?v=[^"'\s>]+)?/g,
                    `/client-logger.js?v=${versions['client-logger.js'] || ASSET_VERSION}`
                )
                .replace(
                    /\/manifest\.json(\?v=[^"'\s>]+)?/g,
                    `/manifest.json?v=${versions['manifest.json'] || ASSET_VERSION}`
                )
                .replace(
                    /\/sw\.js(\?v=[^"'\s>]+)?/g,
                    `/sw.js?v=${versions['sw.js'] || ASSET_VERSION}`
                );

            res.setHeader('Cache-Control', 'no-cache');
            res.send(stamped);
        });
    });

    /**
     * @swagger
     * /promo.html:
     *   get:
     *     summary: Promotional page
     *     description: Serves the promotional/marketing page
     *     tags: ['Frontend']
     *     responses:
     *       200:
     *         description: Promo HTML
     */
    router.get('/promo.html', (req, res) => {
        res.sendFile(path.join(publicDir, 'promo.html'));
    });

    /**
     * @swagger
     * /wallart:
     *   get:
     *     summary: Wallart display page
     *     description: Serves wallart mode HTML with asset versioning
     *     tags: ['Frontend']
     *     responses:
     *       200:
     *         description: Wallart display HTML
     */
    router.get(['/wallart', '/wallart.html'], (req, res, next) => {
        const filePath = path.join(publicDir, 'wallart.html');
        fs.readFile(filePath, 'utf8', (err, contents) => {
            if (err) return next(err);

            const versions = getAssetVersions(path.dirname(publicDir));
            const stamped = contents
                .replace(
                    /wallart\.css\?v=[^"&\s]+/g,
                    `wallart.css?v=${versions['wallart.css'] || ASSET_VERSION}`
                )
                .replace(
                    /wallart\.js\?v=[^"&\s]+/g,
                    `wallart.js?v=${versions['wallart.js'] || ASSET_VERSION}`
                )
                .replace(
                    /device-mgmt\.js\?v=[^"&\s]+/g,
                    `device-mgmt.js?v=${versions['device-mgmt.js'] || ASSET_VERSION}`
                )
                .replace(
                    /lazy-loading\.js\?v=[^"&\s]+/g,
                    `lazy-loading.js?v=${versions['lazy-loading.js'] || ASSET_VERSION}`
                )
                .replace(
                    /\/client-logger\.js(\?v=[^"'\s>]+)?/g,
                    `/client-logger.js?v=${versions['client-logger.js'] || ASSET_VERSION}`
                )
                .replace(
                    /\/manifest\.json(\?v=[^"'\s>]+)?/g,
                    `/manifest.json?v=${versions['manifest.json'] || ASSET_VERSION}`
                )
                .replace(
                    /\/sw\.js(\?v=[^"'\s>]+)?/g,
                    `/sw.js?v=${versions['sw.js'] || ASSET_VERSION}`
                );

            res.setHeader('Cache-Control', 'no-cache');
            res.send(stamped);
        });
    });

    /**
     * @swagger
     * /screensaver:
     *   get:
     *     summary: Screensaver display page
     *     description: Serves screensaver mode HTML with asset versioning
     *     tags: ['Frontend']
     *     responses:
     *       200:
     *         description: Screensaver display HTML
     */
    router.get(['/screensaver', '/screensaver.html'], (req, res, next) => {
        const filePath = path.join(publicDir, 'screensaver.html');
        fs.readFile(filePath, 'utf8', (err, contents) => {
            if (err) return next(err);

            const versions = getAssetVersions(path.dirname(publicDir));
            const stamped = contents
                .replace(
                    /screensaver\.css\?v=[^"&\s]+/g,
                    `screensaver.css?v=${versions['screensaver.css'] || ASSET_VERSION}`
                )
                .replace(
                    /screensaver\.js\?v=[^"&\s]+/g,
                    `screensaver.js?v=${versions['screensaver.js'] || ASSET_VERSION}`
                )
                .replace(
                    /device-mgmt\.js\?v=[^"&\s]+/g,
                    `device-mgmt.js?v=${versions['device-mgmt.js'] || ASSET_VERSION}`
                )
                .replace(
                    /lazy-loading\.js\?v=[^"&\s]+/g,
                    `lazy-loading.js?v=${versions['lazy-loading.js'] || ASSET_VERSION}`
                )
                .replace(
                    /\/client-logger\.js(\?v=[^"'\s>]+)?/g,
                    `/client-logger.js?v=${versions['client-logger.js'] || ASSET_VERSION}`
                )
                .replace(
                    /\/manifest\.json(\?v=[^"'\s>]+)?/g,
                    `/manifest.json?v=${versions['manifest.json'] || ASSET_VERSION}`
                )
                .replace(
                    /\/sw\.js(\?v=[^"'\s>]+)?/g,
                    `/sw.js?v=${versions['sw.js'] || ASSET_VERSION}`
                );

            res.setHeader('Cache-Control', 'no-cache');
            res.send(stamped);
        });
    });

    return router;
};
