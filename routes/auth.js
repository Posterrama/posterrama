/**
 * Authentication Routes
 * Handles admin setup, login, logout, and 2FA management
 */

const express = require('express');
const bcrypt = require('bcrypt');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const { rateLimit } = require('express-rate-limit');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const pkg = require('../package.json');

const logger = require('../utils/logger');

/**
 * @typedef {Object} SessionData
 * @property {{username: string}} [user] - Authenticated user object
 * @property {boolean} [twoFactorPassed] - Whether 2FA has been completed
 * @property {string} [tempUsername] - Temporary username during 2FA flow
 * @property {boolean} [requirePasswordChange] - Whether user must change password
 * @property {boolean} [tfa_required] - Whether 2FA is required for current login
 * @property {{username: string}} [tfa_user] - Temporary user info during 2FA flow
 * @property {any} [pendingAutoRegister] - Pending auto-registration data
 * @property {(callback: (err?: any) => void) => void} [regenerate] - Session regeneration method
 * @property {(callback: (err?: any) => void) => void} [destroy] - Session destruction method
 */

/**
 * @typedef {import('express').Request & { session: SessionData & { sessionID?: string }, sessionID?: string }} RequestWithSession
 */

/**
 * Create authentication router with dependency injection
 * @param {Object} deps - Dependencies
 * @param {Function} deps.isAdminSetup - Check if admin is configured
 * @param {Function} deps.writeEnvFile - Write environment variables
 * @param {Function} deps.restartPM2ForEnvUpdate - Restart PM2 after env changes
 * @param {Function} deps.getAssetVersions - Get asset version hashes
 * @param {boolean} deps.isDebug - Debug mode flag
 * @param {string} deps.ASSET_VERSION - Default asset version
 * @param {Function} deps.isAuthenticated - Authentication middleware
 * @param {Function} deps.authLimiter - Rate limiter for auth endpoints
 * @param {Function} deps.asyncHandler - Async error handler wrapper
 * @param {Function} deps.ApiError - API error class constructor
 * @returns {express.Router} Configured router
 */
module.exports = function createAuthRouter({
    isAdminSetup,
    writeEnvFile,
    restartPM2ForEnvUpdate,
    getAssetVersions,
    isDebug,
    ASSET_VERSION,
    isAuthenticated,
    authLimiter,
    asyncHandler,
    ApiError,
}) {
    const router = express.Router();

    /**
     * @swagger
     * /admin/setup:
     *   get:
     *     summary: Admin setup page
     *     description: Serves the initial admin setup page if no admin user exists, otherwise redirects to admin panel
     *     tags: ['Admin']
     *     responses:
     *       200:
     *         description: Setup page served successfully
     *         content:
     *           text/html:
     *             schema:
     *               type: string
     *       302:
     *         description: Redirects to admin panel if setup is already complete
     */
    router.get('/setup', (/** @type {RequestWithSession} */ req, res) => {
        // If setup is already done, normally redirect to /admin
        // But if the completion flag is present, serve the setup page so it can show the completion message
        const hasCompleteFlag = typeof req.query?.complete !== 'undefined';
        if (isAdminSetup() && !hasCompleteFlag) {
            return res.redirect('/admin');
        }

        const filePath = path.join(__dirname, '..', 'public', 'setup.html');
        fs.readFile(filePath, 'utf8', (err, contents) => {
            if (err) {
                logger.error('Error reading setup.html', {
                    error: err.message,
                    stack: err.stack,
                });
                return res.sendFile(filePath); // Fallback to static file
            }

            // Get current asset versions
            const versions = getAssetVersions(path.join(__dirname, '..'));

            // Replace asset version placeholders with individual file versions
            const stamped = contents.replace(
                /admin\.css\?v=[^"&\s]+/g,
                `admin.css?v=${versions['admin.css'] || ASSET_VERSION}`
            );

            res.setHeader('Cache-Control', 'no-cache'); // always fetch latest HTML shell
            res.send(stamped);
        });
    });

    /**
     * @swagger
     * /admin/setup:
     *   post:
     *     summary: Complete admin setup
     *     description: Creates the initial admin user account with username and password
     *     tags: ['Admin']
     *     requestBody:
     *       required: true
     *       content:
     *         application/x-www-form-urlencoded:
     *           schema:
     *             type: object
     *             required:
     *               - username
     *               - password
     *             properties:
     *               username:
     *                 type: string
     *                 description: Admin username
     *               password:
     *                 type: string
     *                 format: password
     *                 description: Admin password
     *     responses:
     *       200:
     *         description: Admin setup completed successfully
     *       400:
     *         description: Missing username or password
     *       403:
     *         description: Admin user already configured
     */
    router.post(
        '/setup',
        express.urlencoded({ extended: true }),
        asyncHandler(async (req, res) => {
            if (isDebug) logger.debug('[Admin Setup] Received setup request.');
            if (isAdminSetup()) {
                if (isDebug)
                    logger.debug('[Admin Setup] Aborted: Admin user is already configured.');
                throw new /** @type {any} */ (ApiError)(403, 'Admin user is already configured.');
            }

            const { username, password, enable2fa } = req.body;
            if (!username || !password) {
                if (isDebug) logger.debug('[Admin Setup] Aborted: Username or password missing.');
                throw new /** @type {any} */ (ApiError)(400, 'Username and password are required.');
            }

            if (password.length < 8) {
                if (isDebug) logger.debug('[Admin Setup] Aborted: Password too short.');
                throw new /** @type {any} */ (ApiError)(
                    400,
                    'Password must be at least 8 characters long.'
                );
            }

            const saltRounds = 10;
            const passwordHash = await bcrypt.hash(password, saltRounds);
            // Reuse existing SESSION_SECRET if already present to avoid mid-runtime rotation
            const existingSecret = process.env.SESSION_SECRET;
            const sessionSecret =
                existingSecret && existingSecret.trim().length >= 32
                    ? existingSecret
                    : crypto.randomBytes(32).toString('hex');
            if (existingSecret) {
                logger.info(
                    '[Admin Setup] Reusing existing SESSION_SECRET (no rotation during setup)'
                );
            } else {
                logger.info('[Admin Setup] Generated new SESSION_SECRET (first-time setup)');
            }

            let tfaSecret = '';
            let qrCodeDataUrl = null;

            // Check if 2FA should be enabled during setup
            if (enable2fa === 'true') {
                if (isDebug) logger.debug('[Admin Setup] Enabling 2FA during setup...');
                tfaSecret = speakeasy.generateSecret({
                    name: 'Posterrama Admin',
                    issuer: 'Posterrama',
                }).base32;

                // Generate QR code for setup
                const qrCodeUrl = speakeasy.otpauthURL({
                    secret: tfaSecret,
                    label: username,
                    name: 'Posterrama Admin',
                    issuer: 'Posterrama',
                    encoding: 'base32',
                });

                qrCodeDataUrl = await qrcode.toDataURL(qrCodeUrl);
                if (isDebug)
                    logger.debug('[Admin Setup] 2FA secret generated and QR code created.');
            } else {
                if (isDebug) logger.debug('[Admin Setup] 2FA not enabled during setup.');
            }

            await writeEnvFile({
                ADMIN_USERNAME: username,
                ADMIN_PASSWORD_HASH: passwordHash,
                SESSION_SECRET: sessionSecret,
                ADMIN_2FA_SECRET: tfaSecret, // Will be empty string if 2FA not enabled
            });

            if (isDebug)
                logger.debug(
                    `[Admin Setup] Successfully created admin user "${username}". 2FA enabled: ${enable2fa === 'true'}`
                );

            // If 2FA was enabled and we're expecting JSON response (like from setup wizard)
            const wantsJson = String(req.headers.accept || '').includes('application/json');
            if (enable2fa === 'true' && qrCodeDataUrl) {
                return res.json({
                    success: true,
                    message: 'Admin user created successfully with 2FA enabled.',
                    qrCodeDataUrl: qrCodeDataUrl,
                });
            }

            // If the client prefers JSON (fetch from setup wizard), avoid redirects to prevent fetch confusion
            if (wantsJson) {
                return res.json({ success: true, message: 'Admin user created successfully.' });
            }

            // Otherwise redirect to completion page
            res.redirect('/setup.html?complete=1');
        })
    );

    /**
     * @swagger
     * /admin/login:
     *   get:
     *     summary: Admin login page
     *     description: Serves the admin login page, redirects to setup if admin not configured, or to admin panel if already logged in
     *     tags: ['Authentication']
     *     responses:
     *       200:
     *         description: Login page served successfully
     *         content:
     *           text/html:
     *             schema:
     *               type: string
     *       302:
     *         description: Redirects to setup page or admin panel as appropriate
     */
    router.get('/login', (/** @type {RequestWithSession} */ req, res) => {
        if (!isAdminSetup()) {
            return res.redirect('/admin/setup');
        }
        if (req.session.user) {
            return res.redirect('/admin');
        }

        const filePath = path.join(__dirname, '..', 'public', 'login.html');
        fs.readFile(filePath, 'utf8', (err, contents) => {
            if (err) {
                logger.error('Error reading login.html', {
                    error: err.message,
                    stack: err.stack,
                });
                return res.sendFile(filePath); // Fallback to static file
            }

            // Get current asset versions
            const versions = getAssetVersions(path.join(__dirname, '..'));

            // Replace asset version placeholders with individual file versions
            const stamped = contents
                .replace(
                    /admin\.css\?v=[^"&\s]+/g,
                    `admin.css?v=${versions['admin.css'] || ASSET_VERSION}`
                )
                .replace(/__POSTERRAMA_VERSION__/g, String(process.env.APP_VERSION || pkg.version));

            res.setHeader('Cache-Control', 'no-cache'); // always fetch latest HTML shell
            res.send(stamped);
        });
    });

    // Apply rate limiting to protect against brute-force password attacks.
    const loginLimiter = rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 10, // Limit each IP to 10 login requests per windowMs
        standardHeaders: true,
        legacyHeaders: false,
        handler: (req, res) => {
            // Redirect to error page instead of throwing ApiError
            const errorMessage = encodeURIComponent(
                'Too many login attempts from this IP. Please try again after 15 minutes.'
            );
            return res.redirect(`/error.html?error=${errorMessage}`);
        },
    });

    /**
     * @swagger
     * /admin/login:
     *   post:
     *     summary: Admin login authentication
     *     description: Authenticate admin user with username and password. May require 2FA verification if enabled.
     *     tags: ['Authentication']
     *     x-codeSamples:
     *       - lang: 'curl'
     *         label: 'cURL'
     *         source: |
     *           curl -X POST http://localhost:4000/admin/login \
     *             -H "Content-Type: application/x-www-form-urlencoded" \
     *             -d "username=admin&password=your-password" \
     *             -c cookies.txt
     *       - lang: 'JavaScript'
     *         label: 'JavaScript (fetch)'
     *         source: |
     *           fetch('http://localhost:4000/admin/login', {
     *             method: 'POST',
     *             headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
     *             body: new URLSearchParams({
     *               username: 'admin',
     *               password: 'your-password'
     *             }),
     *             credentials: 'include' // Important: include cookies
     *           })
     *             .then(response => response.json())
     *             .then(data => console.log(data));
     *       - lang: 'Python'
     *         label: 'Python (requests)'
     *         source: |
     *           import requests
     *           session = requests.Session()
     *           response = session.post(
     *               'http://localhost:4000/admin/login',
     *               data={'username': 'admin', 'password': 'your-password'}
     *           )
     *           print(response.json())
     *     requestBody:
     *       required: true
     *       content:
     *         application/x-www-form-urlencoded:
     *           schema:
     *             type: object
     *             required:
     *               - username
     *               - password
     *             properties:
     *               username:
     *                 type: string
     *                 description: Admin username
     *               password:
     *                 type: string
     *                 format: password
     *                 description: Admin password
     *     responses:
     *       200:
     *         description: Login successful (may redirect to 2FA verification)
     *       401:
     *         description: Invalid username or password
     *       429:
     *         description: Too many login attempts
     */
    router.post(
        '/login',
        loginLimiter,
        express.urlencoded({ extended: true }),
        async (/** @type {RequestWithSession} */ req, res) => {
            try {
                logger.info(`[Admin Login] POST /admin/login route hit`);
                if (isDebug) logger.debug(`[Admin Login] Received login request:`, req.body);

                const { username, password } = req.body;
                if (isDebug) logger.debug(`[Admin Login] Attempting login for user "${username}".`);

                // Check if admin is setup
                if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD_HASH) {
                    if (isDebug) logger.debug(`[Admin Login] Admin not setup yet.`);
                    return res.status(400).json({
                        error: 'Admin user not configured. Please run the setup first.',
                    });
                }

                const isValidUser = username === process.env.ADMIN_USERNAME;
                if (!isValidUser) {
                    if (isDebug)
                        logger.info(
                            `[Admin Login] Login failed for user "${username}". Invalid username.`
                        );
                    return res
                        .status(401)
                        .json({ error: 'Invalid username or password. Please try again.' });
                }

                const isValidPassword = await bcrypt.compare(
                    password,
                    process.env.ADMIN_PASSWORD_HASH
                );
                if (!isValidPassword) {
                    if (isDebug)
                        logger.debug(
                            `[Admin Login] Login failed for user "${username}". Invalid credentials.`
                        );
                    return res
                        .status(401)
                        .json({ error: 'Invalid username or password. Please try again.' });
                }

                // --- Check if 2FA is enabled ---
                const secret = process.env.ADMIN_2FA_SECRET || '';
                const is2FAEnabled = secret.trim() !== '';

                if (is2FAEnabled) {
                    // User is valid, but needs to provide a 2FA code.
                    // Set a temporary flag in the session.
                    req.session.tfa_required = true;
                    req.session.tfa_user = { username: username }; // Store user info temporarily
                    if (isDebug)
                        logger.debug(
                            `[Admin Login] Credentials valid for "${username}". Requires 2FA verification.`
                        );
                    return res.status(200).json({
                        success: true,
                        requires2FA: true,
                        redirectTo: '/admin/2fa-verify',
                    });
                } else {
                    // No 2FA, log the user in directly. Regenerate session to prevent fixation.

                    // SAVE auto-register data BEFORE session regeneration
                    const pendingAutoRegister = req.session.pendingAutoRegister;
                    logger.info(
                        `[Auto-Register] Saving auto-register data before session regeneration: ${JSON.stringify(pendingAutoRegister)}`
                    );

                    return req.session.regenerate(err => {
                        if (err) {
                            logger.error('[Admin Login] Error regenerating session:', err);
                            return res.status(500).json({ error: 'Internal server error.' });
                        }
                        req.session.user = { username };
                        if (isDebug)
                            logger.debug(`[Admin Login] Login successful for user "${username}".`);

                        // Log successful login with detailed context
                        logger.info('✅ Admin login successful', {
                            username,
                            ip: req.ip || req.connection.remoteAddress,
                            userAgent: req.get('user-agent'),
                            sessionId: req.sessionID,
                            timestamp: new Date().toISOString(),
                        });

                        // Check for saved auto-register parameters
                        if (pendingAutoRegister && pendingAutoRegister.deviceId) {
                            logger.info(
                                `[Auto-Register] Restoring auto-register parameters after login: ${JSON.stringify(pendingAutoRegister)}`
                            );
                            const autoRegisterUrl = `/admin?auto-register=true&device-id=${encodeURIComponent(pendingAutoRegister.deviceId)}&device-name=${encodeURIComponent(pendingAutoRegister.deviceName || pendingAutoRegister.deviceId)}`;
                            // No need to clear data since we regenerated the session
                            return res.status(200).json({
                                success: true,
                                requires2FA: false,
                                redirectTo: autoRegisterUrl,
                            });
                        }

                        return res.status(200).json({
                            success: true,
                            requires2FA: false,
                            redirectTo: '/admin',
                        });
                    });
                }
            } catch (error) {
                logger.error('[Admin Login] Error', {
                    error: error.message,
                    stack: error.stack,
                });
                return res.status(500).json({ error: 'Internal server error. Please try again.' });
            }
        }
    );

    /**
     * @swagger
     * /admin/2fa-verify:
     *   get:
     *     summary: Two-factor authentication verification page
     *     description: Serves the 2FA verification page for users who have completed initial login
     *     tags: ['Authentication']
     *     responses:
     *       200:
     *         description: 2FA verification page served successfully
     *         content:
     *           text/html:
     *             schema:
     *               type: string
     *       302:
     *         description: Redirect to login if 2FA not required
     */
    router.get('/2fa-verify', (/** @type {RequestWithSession} */ req, res) => {
        // Only show this page if the user has passed the first step of login.
        if (!req.session.tfa_required) {
            return res.redirect('/admin/login');
        }

        const filePath = path.join(__dirname, '..', 'public', '2fa-verify.html');
        fs.readFile(filePath, 'utf8', (err, contents) => {
            if (err) {
                logger.error('Error reading 2fa-verify.html', {
                    error: err.message,
                    stack: err.stack,
                });
                return res.sendFile(filePath); // Fallback to static file
            }

            // Get current asset versions
            const versions = getAssetVersions(path.join(__dirname, '..'));

            // Replace asset version placeholders with individual file versions
            const stamped = contents.replace(
                /admin\.css\?v=[^"&\s]+/g,
                `admin.css?v=${versions['admin.css'] || ASSET_VERSION}`
            );

            res.setHeader('Cache-Control', 'no-cache'); // always fetch latest HTML shell
            res.send(stamped);
        });
    });

    // Apply a stricter rate limit for 2FA code attempts.
    const twoFaLimiter = rateLimit({
        windowMs: 5 * 60 * 1000, // 5 minutes
        max: 5, // Limit each IP to 5 verification requests per windowMs
        standardHeaders: true,
        legacyHeaders: false,
        message: (req, res) => {
            // Redirecting with an error is better UX for this form.
            res.redirect('/admin/2fa-verify?error=rate_limited');
        },
    });

    /**
     * @swagger
     * /admin/2fa-verify:
     *   post:
     *     summary: Verify two-factor authentication code
     *     description: Verifies the TOTP code and completes the admin login process
     *     tags: ['Authentication']
     *     requestBody:
     *       required: true
     *       content:
     *         application/x-www-form-urlencoded:
     *           schema:
     *             type: object
     *             properties:
     *               totp_code:
     *                 type: string
     *                 description: 6-digit TOTP code from authenticator app
     *                 pattern: "^\\d{6}$"
     *             required:
     *               - totp_code
     *     responses:
     *       200:
     *         description: 2FA verification successful, user logged in
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                 message:
     *                   type: string
     *                 redirectTo:
     *                   type: string
     *       400:
     *         description: Invalid or missing TOTP code
     *       302:
     *         description: Redirect to login if 2FA session expired
     */

    router.post(
        '/2fa-verify',
        twoFaLimiter,
        express.urlencoded({ extended: true }),
        asyncHandler(async (req, res) => {
            const { totp_code } = req.body;

            if (!req.session.tfa_required || !req.session.tfa_user) {
                if (isDebug)
                    logger.debug(
                        '[Admin 2FA Verify] 2FA verification attempted without prior password validation. Redirecting to login.'
                    );
                return res.redirect('/admin/login');
            }

            const secret = process.env.ADMIN_2FA_SECRET || '';
            const verified = speakeasy.totp.verify({
                secret,
                encoding: 'base32',
                token: totp_code,
                window: 1,
            });

            if (verified) {
                // Snapshot user before regenerating session; regeneration creates a new session object
                const { username } = req.session.tfa_user || {};
                // Rotate session on successful 2FA to prevent fixation
                await new Promise((resolve, reject) => {
                    req.session.regenerate(err => {
                        if (err) return reject(err);
                        return resolve();
                    });
                });
                req.session.user = { username };
                // Clean up any 2FA flags on the fresh session
                delete req.session.tfa_required;
                delete req.session.tfa_user;
                if (isDebug)
                    logger.debug(
                        `[Admin 2FA Verify] 2FA verification successful for user "${username}".`
                    );

                // Log successful 2FA login with detailed context
                logger.info('✅ Admin 2FA login successful', {
                    username,
                    ip: req.ip || req.connection.remoteAddress,
                    userAgent: req.get('user-agent'),
                    sessionId: req.sessionID,
                    timestamp: new Date().toISOString(),
                });

                // Check for pending auto-register parameters
                const pendingAutoRegister = req.session.pendingAutoRegister;
                if (pendingAutoRegister && pendingAutoRegister.deviceId) {
                    logger.info(
                        `[Auto-Register] Restoring auto-register parameters after 2FA: ${JSON.stringify(pendingAutoRegister)}`
                    );
                    const autoRegisterUrl = `/admin?auto-register=true&device-id=${encodeURIComponent(pendingAutoRegister.deviceId)}&device-name=${encodeURIComponent(pendingAutoRegister.deviceName || pendingAutoRegister.deviceId)}`;
                    // Clear the pending data
                    delete req.session.pendingAutoRegister;
                    return res.redirect(autoRegisterUrl);
                }

                res.redirect('/admin');
            } else {
                if (isDebug)
                    logger.debug(
                        `[Admin 2FA Verify] Invalid 2FA code for user "${req.session.tfa_user.username}".`
                    );
                // Redirect back to the verification page with an error query parameter
                // for a better user experience than a generic error page.
                res.redirect('/admin/2fa-verify?error=invalid_code');
            }
        })
    );

    /**
     * @swagger
     * /admin/logout:
     *   get:
     *     summary: Admin logout
     *     description: Logs out the admin user by destroying their session and redirects to login page
     *     tags: ['Authentication']
     *     responses:
     *       302:
     *         description: Session destroyed, redirects to login page
     *       500:
     *         description: Error destroying session
     */
    router.get('/logout', (/** @type {RequestWithSession} */ req, res, next) => {
        const user = req.session.user;
        if (isDebug) logger.debug(`[Admin Logout] User "${user?.username}" logging out.`);

        // Log logout before destroying session
        if (user) {
            logger.info('👋 Admin logout', {
                username: user.username,
                ip: req.ip || req.connection.remoteAddress,
                sessionId: req.sessionID,
                timestamp: new Date().toISOString(),
            });
        }

        req.session.destroy(err => {
            if (err) {
                if (isDebug)
                    logger.error('[Admin Logout] Error destroying session', {
                        error: err.message,
                        stack: err.stack,
                    });
                return next(new /** @type {any} */ (ApiError)(500, 'Could not log out.'));
            }
            if (isDebug) logger.debug('[Admin Logout] Session destroyed successfully.');
            // Clear cookie explicitly
            res.clearCookie('posterrama.sid');
            res.redirect('/admin/login');
        });
    });

    /**
     * @swagger
     * /api/admin/2fa/generate:
     *   post:
     *     summary: Generate a new 2FA secret
     *     description: >
     *       Generates a new secret for Two-Factor Authentication (2FA) and returns a QR code
     *       that the user can scan with an authenticator app. The secret is temporarily stored in the session
     *       and only becomes permanent after successful verification.
     *     tags: ['Admin']
     *     security:
     *       - bearerAuth: []
     *     responses:
     *       200:
     *         description: QR code and secret successfully generated.
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Generate2FAResponse'
     *       400:
     *         description: 2FA is already enabled.
     *       401:
     *         description: Unauthorized.
     */
    router.post(
        '/api/admin/2fa/generate',
        // @ts-ignore - asyncHandler wrapper causes TypeScript overload issue
        authLimiter,
        isAuthenticated,
        asyncHandler(async (req, res) => {
            const secret = process.env.ADMIN_2FA_SECRET || '';
            const isEnabled = secret.trim() !== '';
            // Prevent generating a new secret if one is already active
            if (isEnabled) {
                throw new /** @type {any} */ (ApiError)(400, '2FA is already enabled.');
            }

            const newSecret = speakeasy.generateSecret({
                length: 20,
                name: `posterrama.app (${req.session.user.username})`,
            });

            // Store the new secret in the session, waiting for verification.
            // This is crucial so we don't lock the user out if they fail to verify.
            req.session.tfa_pending_secret = newSecret.base32;

            const qrCodeDataUrl = await qrcode.toDataURL(newSecret.otpauth_url);
            res.json({ qrCodeDataUrl });
        })
    );

    /**
     * @swagger
     * /api/admin/2fa/verify:
     *   post:
     *     summary: Verify and enable 2FA
     *     description: >
     *       Verifies the TOTP code entered by the user against the temporary secret in the session.
     *       Upon success, the 2FA secret is permanently stored in the .env file and 2FA is activated.
     *     tags: ['Admin']
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/Verify2FARequest'
     *     responses:
     *       200:
     *         description: 2FA successfully enabled.
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/AdminApiResponse'
     *       400:
     *         description: Invalid verification code or no 2FA process pending.
     *       401:
     *         description: Unauthorized
     */
    router.post(
        '/api/admin/2fa/verify',
        // @ts-ignore - asyncHandler wrapper causes TypeScript overload issue
        authLimiter,
        isAuthenticated,
        express.json(),
        asyncHandler(async (req, res) => {
            const { token } = req.body;
            const pendingSecret = req.session.tfa_pending_secret;

            if (!pendingSecret) {
                throw new /** @type {any} */ (ApiError)(
                    400,
                    'No 2FA setup process is pending. Please try again.'
                );
            }

            const verified = speakeasy.totp.verify({
                secret: pendingSecret,
                encoding: 'base32',
                token: token,
                window: 1,
            });

            if (verified) {
                // Verification successful, save the secret to the .env file
                await writeEnvFile({ ADMIN_2FA_SECRET: pendingSecret });

                // Clear the pending secret from the session
                delete req.session.tfa_pending_secret;

                // Restart PM2 to clear environment cache
                restartPM2ForEnvUpdate('2FA enabled');

                if (isDebug)
                    logger.debug(
                        `[Admin 2FA] 2FA enabled successfully for user "${req.session.user.username}".`
                    );
                res.json({ success: true, message: '2FA enabled successfully.' });
            } else {
                if (isDebug)
                    logger.debug(
                        `[Admin 2FA] 2FA verification failed for user "${req.session.user.username}".`
                    );
                throw new /** @type {any} */ (ApiError)(
                    400,
                    'Invalid verification code. Please try again.'
                );
            }
        })
    );

    /**
     * @swagger
     * /api/admin/2fa/disable:
     *   post:
     *     summary: Disable 2FA
     *     description: >
     *       Disables Two-Factor Authentication for the admin account.
     *       The user must provide their current password for confirmation.
     *     tags: ['Admin']
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/Disable2FARequest'
     *     responses:
     *       200:
     *         description: 2FA successfully disabled.
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/AdminApiResponse'
     *       400:
     *         description: Password is required.
     *       401:
     *         description: Invalid password or unauthorized.
     */
    router.post(
        '/api/admin/2fa/disable',
        // @ts-ignore - asyncHandler wrapper causes TypeScript overload issue
        authLimiter,
        isAuthenticated,
        express.json(),
        asyncHandler(async (req, res) => {
            const { password } = req.body;
            if (!password)
                throw new /** @type {any} */ (ApiError)(
                    400,
                    'Password is required to disable 2FA.'
                );
            const isValidPassword = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);
            if (!isValidPassword)
                throw new /** @type {any} */ (ApiError)(401, 'Incorrect password.');

            // Clear 2FA secret from .env file (writeEnvFile updates process.env automatically)
            await writeEnvFile({ ADMIN_2FA_SECRET: '' });

            // Clear 2FA from session to prevent re-verification on next page load
            if (req.session) {
                req.session.twoFactorVerified = false;
            }

            logger.info('[Admin 2FA] 2FA disabled successfully', {
                user: req.session.user.username,
                timestamp: new Date().toISOString(),
            });

            // Send response before PM2 restart (restart may terminate current process)
            res.json({
                success: true,
                message: '2FA disabled. Server will restart to apply changes.',
            });

            // Restart PM2 to clear environment cache
            await restartPM2ForEnvUpdate('2FA disabled');
        })
    );

    return router;
};
