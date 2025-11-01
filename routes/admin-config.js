/**
 * Admin Configuration Routes
 * Server configuration management and connection testing endpoints
 */

const express = require('express');
const path = require('path');
const fs = require('fs');

/**
 * Create admin configuration router
 * @param {Object} deps - Dependencies
 * @returns {express.Router} Configured router
 */
module.exports = function createAdminConfigRouter({
    config,
    logger,
    isDebug,
    FIXED_LIMITS,
    readConfig,
    readEnvFile,
    writeConfig,
    writeEnvFile,
    restartPM2ForEnvUpdate,
    wsHub,
    ApiError,
    asyncHandler,
    isAuthenticated,
    createPlexClient,
    createJellyfinClient,
    serverIPAddress,
    port,
}) {
    const router = express.Router();

    /**
     * @swagger
     * /api/admin/config-schema:
     *   get:
     *     summary: Get configuration schema
     *     description: Returns JSON schema for configuration validation and autocomplete
     *     tags: ['Admin']
     *     security:
     *       - bearerAuth: []
     *     responses:
     *       200:
     *         description: Configuration schema
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *       401:
     *         description: Unauthorized
     */
    router.get('/api/admin/config-schema', isAuthenticated, (req, res) => {
        try {
            const schemaPath = path.join(__dirname, '..', 'config.schema.json');
            const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
            res.json(schema);
        } catch (e) {
            logger.error('[Admin Config] Failed to read config schema:', e);
            res.status(500).json({ error: 'failed_to_read_schema' });
        }
    });

    router.get(
        '/api/admin/config',
        isAuthenticated,
        asyncHandler(async (req, res) => {
            if (isDebug) logger.debug('[Admin API] Request received for /api/admin/config.');
            const currentConfig = await readConfig();
            if (isDebug) logger.debug('[Admin API] Successfully read config.json.');

            // Convert streaming sources array to object format for admin panel
            if (currentConfig.streamingSources && Array.isArray(currentConfig.streamingSources)) {
                const streamingArray = currentConfig.streamingSources;
                const streamingObject = {
                    enabled: streamingArray.some(source => source.enabled),
                    region: 'US',
                    maxItems: 20,
                    minRating: 0,
                    netflix: false,
                    disney: false,
                    prime: false,
                    hbo: false,
                    newReleases: false,
                };

                // Extract settings from first enabled source
                const firstEnabled = streamingArray.find(source => source.enabled);
                if (firstEnabled) {
                    streamingObject.region = firstEnabled.watchRegion || 'US';
                    // Reflect fixed per-provider limits in the admin view
                    streamingObject.maxItems =
                        FIXED_LIMITS.STREAMING_MOVIES_PER_PROVIDER +
                            FIXED_LIMITS.STREAMING_TV_PER_PROVIDER || 20;
                    streamingObject.minRating = firstEnabled.minRating || 0;
                }

                // Set provider checkboxes based on enabled sources
                streamingArray.forEach(source => {
                    if (source.enabled) {
                        switch (source.category) {
                            case 'streaming_netflix':
                                streamingObject.netflix = true;
                                break;
                            case 'streaming_disney':
                                streamingObject.disney = true;
                                break;
                            case 'streaming_prime':
                                streamingObject.prime = true;
                                break;
                            case 'streaming_hbo':
                                streamingObject.hbo = true;
                                break;
                            case 'streaming_hulu':
                                streamingObject.hulu = true;
                                break;
                            case 'streaming_apple':
                                streamingObject.apple = true;
                                break;
                            case 'streaming_paramount':
                                streamingObject.paramount = true;
                                break;
                            case 'streaming_crunchyroll':
                                streamingObject.crunchyroll = true;
                                break;
                            case 'streaming_new_releases':
                                streamingObject.newReleases = true;
                                break;
                        }
                    }
                });

                currentConfig.streamingSources = streamingObject;
                logger.debug(
                    '[Streaming Debug] Converted streaming array to object for admin panel:',
                    JSON.stringify(streamingObject, null, 2)
                );
            }

            // WARNING: Exposing environment variables to the client can be a security risk.
            // This is done based on an explicit user request.
            const envVarsToExpose = {
                SERVER_PORT: process.env.SERVER_PORT,
                DEBUG: process.env.DEBUG,
            };

            if (Array.isArray(currentConfig.mediaServers)) {
                currentConfig.mediaServers.forEach(server => {
                    // Ensure server is a valid object before processing to prevent crashes
                    if (server && typeof server === 'object') {
                        // Find all keys ending in 'EnvVar' and get their values from process.env
                        Object.keys(server).forEach(key => {
                            if (key.endsWith('EnvVar')) {
                                const envVarName = server[key];
                                if (envVarName) {
                                    const isSensitive =
                                        key.toLowerCase().includes('token') ||
                                        key.toLowerCase().includes('password') ||
                                        key.toLowerCase().includes('apikey');
                                    if (isSensitive) {
                                        // For sensitive fields, just indicate if they are set or not.
                                        envVarsToExpose[envVarName] = !!process.env[envVarName];
                                    } else if (process.env[envVarName]) {
                                        envVarsToExpose[envVarName] = process.env[envVarName];
                                    }
                                }
                            }
                        });
                    }
                });
            }

            if (isDebug)
                logger.debug(
                    '[Admin API] Sending config and selected environment variables to client.'
                );
            res.json({
                config: currentConfig,
                env: envVarsToExpose,
                security: { is2FAEnabled: !!(process.env.ADMIN_2FA_SECRET || '').trim() },
                server: { ipAddress: serverIPAddress },
            });
        })
    );

    /**
     * @swagger
     * /api/admin/config:
     *   post:
     *     summary: Save configuration changes
     *     description: Updates config.json and .env with provided changes. Detects mode changes and broadcasts navigation commands to connected devices.
     *     tags: ['Admin']
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               config:
     *                 type: object
     *                 description: Partial configuration object to merge
     *               env:
     *                 type: object
     *                 description: Environment variables to update
     *     responses:
     *       200:
     *         description: Configuration saved successfully
     *       400:
     *         description: Invalid request body
     *       401:
     *         description: Unauthorized
     */
    router.post(
        '/api/admin/config',
        isAuthenticated,
        express.json(),
        asyncHandler(async (req, res) => {
            const { config: newConfig, env: newEnv } = req.body || {};

            if (!newConfig || !newEnv) {
                throw new ApiError(
                    400,
                    'Invalid request body. "config" and "env" properties are required.'
                );
            }

            // Read existing config for merging and mode change detection
            const existingConfig = await readConfig();
            const mergedConfig = { ...existingConfig, ...newConfig };

            // Detect mode changes for broadcast to devices
            let broadcastModeChange = null;
            try {
                // Check Display Settings mode changes (cinemaMode, wallartMode.enabled)
                const oldCinema = !!existingConfig.cinemaMode;
                const newCinema = !!mergedConfig.cinemaMode;
                const oldWallart = !!(
                    existingConfig.wallartMode && existingConfig.wallartMode.enabled
                );
                const newWallart = !!(mergedConfig.wallartMode && mergedConfig.wallartMode.enabled);

                const oldMode = oldCinema ? 'cinema' : oldWallart ? 'wallart' : 'screensaver';
                const newMode = newCinema ? 'cinema' : newWallart ? 'wallart' : 'screensaver';

                if (oldMode !== newMode) {
                    broadcastModeChange = newMode;
                    logger.info('[Admin API] Display mode changed, will broadcast navigation', {
                        from: oldMode,
                        to: newMode,
                    });
                }

                // Also check rootRoute.defaultMode changes (Entry Route setting)
                const oldDefaultMode = existingConfig.rootRoute?.defaultMode || '';
                const newDefaultMode = mergedConfig.rootRoute?.defaultMode || '';
                const behavior = mergedConfig.rootRoute?.behavior || 'landing';

                if (
                    behavior === 'redirect' &&
                    oldDefaultMode &&
                    newDefaultMode &&
                    oldDefaultMode !== newDefaultMode &&
                    ['screensaver', 'wallart', 'cinema'].includes(newDefaultMode)
                ) {
                    broadcastModeChange = newDefaultMode;
                    logger.info(
                        '[Admin API] Entry Route defaultMode changed, will broadcast navigation',
                        {
                            from: oldDefaultMode,
                            to: newDefaultMode,
                        }
                    );
                }
            } catch (e) {
                logger.warn('[Admin API] Mode change detection failed:', e?.message || e);
            }

            // Write config.json
            await writeConfig(mergedConfig, config);
            logger.info('[Admin API] Successfully wrote config.json');

            // Prepare env variables for writing (sanitize and validate)
            const sanitizedEnv = {};
            Object.entries(newEnv).forEach(([key, value]) => {
                if (key === 'NODE_ENV') {
                    logger.warn('[Admin API] Skipping NODE_ENV write (managed by PM2)');
                    return;
                }
                if (
                    typeof value === 'string' ||
                    typeof value === 'number' ||
                    typeof value === 'boolean'
                ) {
                    sanitizedEnv[key] = String(value);
                } else if (value === null || value === undefined) {
                    // Skip null/undefined values (don't write to .env)
                    logger.debug(`[Admin API] Skipping null/undefined env value for ${key}`);
                }
            });

            // Write .env if there are changes
            if (Object.keys(sanitizedEnv).length > 0) {
                await writeEnvFile(sanitizedEnv);
                logger.info('[Admin API] Successfully wrote .env file', {
                    keys: Object.keys(sanitizedEnv),
                });
            }

            // Broadcast mode.navigate command to all connected devices
            if (broadcastModeChange && wsHub) {
                try {
                    const mode = broadcastModeChange;
                    const ok = wsHub.broadcast({
                        kind: 'command',
                        type: 'mode.navigate',
                        payload: { mode },
                    });
                    logger.info('[WS] Broadcast mode.navigate to devices', { mode, success: ok });
                } catch (e) {
                    logger.warn('[WS] mode.navigate broadcast failed:', e?.message || e);
                }
            }

            // Update in-memory config so routes see latest values
            Object.assign(config, mergedConfig);

            // Restart PM2 if environment variables changed (for tokens/secrets)
            if (Object.keys(sanitizedEnv).length > 0) {
                restartPM2ForEnvUpdate('configuration saved');
            }

            res.json({
                success: true,
                message: 'Configuration saved successfully',
                modeChanged: !!broadcastModeChange,
                targetMode: broadcastModeChange || undefined,
            });
        })
    );

    /**
     * @swagger
     * /api/config/schema:
     *   get:
     *     summary: Retrieve configuration JSON schema
     *     description: Returns the config.schema.json used for validating configuration. Admin-only.
     *     tags: ['Admin']
     *     security:
     *       - bearerAuth: []
     *     responses:
     *       200:
     *         description: The JSON schema document
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *       401:
     *         description: Unauthorized.
     */
    router.get(
        '/api/config/schema',
        isAuthenticated,
        asyncHandler(async (_req, res) => {
            try {
                const schemaPath = path.join(__dirname, 'config.schema.json');
                const raw = await fs.promises.readFile(schemaPath, 'utf8');
                res.type('application/json').send(raw);
            } catch (e) {
                logger.error('[Admin API] Failed to read config.schema.json:', e && e.message);
                res.status(500).json({ error: 'schema_read_failed' });
            }
        })
    );

    // Back-compat/admin-prefixed alias so proxies that gate admin endpoints under /api/admin continue to work
    /**
     * @swagger
     * /api/admin/config/schema:
     *   get:
     *     summary: Retrieve configuration JSON schema (admin alias)
     *     description: Alias of /api/config/schema for environments routing admin traffic under /api/admin.
     *     tags: ['Admin']
     *     security:
     *       - bearerAuth: []
     *     responses:
     *       200:
     *         description: The JSON schema document
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *       401:
     *         description: Unauthorized.
     */
    router.get(
        '/api/admin/config/schema',
        isAuthenticated,
        asyncHandler(async (_req, res) => {
            try {
                const schemaPath = path.join(__dirname, 'config.schema.json');
                const raw = await fs.promises.readFile(schemaPath, 'utf8');
                res.type('application/json').send(raw);
            } catch (e) {
                logger.error(
                    '[Admin API] Failed to read config.schema.json (admin alias):',
                    e && e.message
                );
                res.status(500).json({ error: 'schema_read_failed' });
            }
        })
    );

    /**
     * @swagger
     * /api/admin/config-schema:
     *   get:
     *     summary: Retrieve configuration JSON schema (alias)
     *     description: Alias of /api/admin/config/schema returning config.schema.json for autocomplete tooling in the admin UI.
     *     tags: ['Admin']
     *     security:
     *       - bearerAuth: []
     *     responses:
     *       200:
     *         description: The JSON schema document
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *       401:
     *         description: Unauthorized.
     */
    router.get(
        '/api/admin/config-schema',
        isAuthenticated,
        asyncHandler(async (_req, res) => {
            try {
                const schemaPath = path.join(__dirname, 'config.schema.json');
                const raw = await fs.promises.readFile(schemaPath, 'utf8');
                res.type('application/json').send(raw);
            } catch (e) {
                logger.error(
                    '[Admin API] Failed to read config.schema.json (admin config-schema alias):',
                    e && e.message
                );
                res.status(500).json({ error: 'schema_read_failed' });
            }
        })
    );

    /**
     * @swagger
     * /api/admin/test-plex:
     *   post:
     *     summary: Test connection to a Plex server
     *     description: >
     *       Checks if the application can connect to a Plex server with the provided
     *       hostname, port, and token. This is a lightweight check that queries the server root.
     *     tags: ['Admin']
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/PlexConnectionRequest'
     *     responses:
     *       200:
     *         description: Connection successful.
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/AdminApiResponse'
     *       400:
     *         description: Connection error (e.g., incorrect credentials, timeout).
     */
    router.post(
        '/api/admin/test-plex',
        isAuthenticated,
        express.json(),
        asyncHandler(async (req, res) => {
            if (isDebug) logger.debug('[Admin API] Received request to test Plex connection.');
            let { hostname, token } = req.body; // token is now optional
            const { port: portValue } = req.body;

            // DEBUG: Log what we received
            logger.debug('[Plex Test] Request body:', {
                hostname,
                token: token ? `${token.substring(0, 5)}...(${token.length})` : 'not provided',
                port: portValue,
            });

            if (!hostname || !portValue) {
                throw new ApiError(400, 'Hostname and port are required for the test.');
            }

            // Sanitize hostname to remove http(s):// prefix
            if (hostname) {
                hostname = hostname.trim().replace(/^https?:\/\//, '');
            }

            // If no token is provided in the request, use the one from the server's config.
            if (!token) {
                if (isDebug)
                    logger.debug(
                        '[Plex Test] No token provided in request, attempting to use existing server token.'
                    );
                // Find the Plex server config (enabled or disabled)
                const plexServerConfig = config.mediaServers.find(s => s.type === 'plex');

                if (plexServerConfig && plexServerConfig.tokenEnvVar) {
                    token = process.env[plexServerConfig.tokenEnvVar];
                    logger.debug('[Plex Test] Using token from env:', {
                        envVar: plexServerConfig.tokenEnvVar,
                        tokenExists: !!token,
                        tokenLength: token ? token.length : 0,
                        tokenPreview: token ? `${token.substring(0, 5)}...` : 'empty',
                    });
                    if (!token) {
                        throw new ApiError(
                            400,
                            'Connection test failed: No new token was provided, and no token is configured on the server.'
                        );
                    }
                } else {
                    throw new ApiError(
                        500,
                        'Connection test failed: Could not find Plex server configuration on the server.'
                    );
                }
            }

            try {
                const testClient = await createPlexClient({
                    hostname,
                    port: portValue,
                    token,
                    timeout: 5000,
                });
                // Querying the root is a lightweight way to check credentials and reachability.
                const result = await testClient.query('/');
                const serverName = result?.MediaContainer?.friendlyName;

                if (serverName) {
                    res.json({
                        success: true,
                        message: `Successfully connected to Plex server: ${serverName}`,
                    });
                } else {
                    // This case is unlikely if the query succeeds, but good to handle.
                    res.json({
                        success: true,
                        message: 'Connection successful, but could not retrieve the server name.',
                    });
                }
            } catch (error) {
                if (isDebug) console.error('[Plex Test] Connection failed:', error.message);
                let userMessage = 'Connection failed. Please check the hostname, port, and token.';
                if (error.code === 'ECONNREFUSED' || error.message.includes('ECONNREFUSED')) {
                    userMessage = `Connection refused to ${hostname}:${port}. Is Plex running on this address? Check if the hostname and port are correct.`;
                } else if (error.message.includes('401 Unauthorized')) {
                    userMessage =
                        'Connection failed: Unauthorized. The Plex token is incorrect or has expired.';
                } else if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
                    userMessage = `Connection timed out to ${hostname}:${port}. Is the server reachable? Check firewall settings.`;
                } else if (error.code === 'ENOTFOUND' || error.message.includes('ENOTFOUND')) {
                    userMessage = `Hostname "${hostname}" not found. Please check if the hostname is correct.`;
                }
                throw new ApiError(400, userMessage);
            }
        })
    );

    /**
     * @swagger
     * /api/admin/plex-libraries:
     *   post:
     *     summary: Retrieve Plex libraries
     *     description: >
     *       Retrieves a list of all available libraries (such as 'Movies', 'TV Shows')
     *       from the configured Plex server.
     *     tags: ['Admin']
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       description: Optional connection details. If not provided, the configured values will be used.
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/PlexConnectionRequest'
     *     responses:
     *       200:
     *         description: A list of found libraries.
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/PlexLibrariesResponse'
     *       400:
     *         description: Could not fetch libraries (e.g., incorrect credentials).
     */
    router.post(
        '/api/admin/plex-libraries',
        isAuthenticated,
        asyncHandler(async (req, res) => {
            if (isDebug) logger.debug('[Admin API] Received request to fetch Plex libraries.');

            // Extract request parameters (avoid logging large objects)
            let { hostname, port, token } = req.body;

            // DEBUG: Log extracted values only (not entire body to avoid OOM)
            if (isDebug) {
                logger.debug('[Plex Libraries] Extracted values:', {
                    hostname,
                    port: port,
                    portType: typeof port,
                    token: token ? `${token.substring(0, 5)}...(${token.length})` : 'MISSING',
                });
            }

            // Sanitize hostname
            if (hostname) {
                hostname = hostname.trim().replace(/^https?:\/\//, '');
            }

            // Fallback to configured values if not provided in the request
            const plexServerConfig = config.mediaServers.find(s => s.type === 'plex');
            if (!plexServerConfig) {
                throw new ApiError(500, 'Plex server is not configured in config.json.');
            }

            if (!hostname && plexServerConfig.hostname) {
                hostname = plexServerConfig.hostname.trim().replace(/^https?:\/\//, '');
            }
            if (!port && typeof plexServerConfig.port !== 'undefined') {
                port = plexServerConfig.port;
            }
            token = token || process.env[plexServerConfig.tokenEnvVar];

            if (!hostname || !port || !token) {
                throw new ApiError(
                    400,
                    'Plex connection details (hostname, port, token) are missing.'
                );
            }

            try {
                const client = await createPlexClient({
                    hostname,
                    port,
                    token,
                    timeout: 10000,
                });
                const sectionsResponse = await client.query('/library/sections');
                const allSections = sectionsResponse?.MediaContainer?.Directory || [];

                // Fetch item counts for each library
                const libraries = await Promise.all(
                    allSections.map(async dir => {
                        let itemCount = 0;
                        try {
                            // Only fetch count for movie and show libraries
                            if (dir.type === 'movie' || dir.type === 'show') {
                                const sectionResponse = await client.query(
                                    `/library/sections/${dir.key}/all?X-Plex-Container-Start=0&X-Plex-Container-Size=1`
                                );
                                itemCount = parseInt(
                                    sectionResponse?.MediaContainer?.totalSize || 0
                                );
                            }
                        } catch (countError) {
                            if (isDebug)
                                logger.debug(
                                    `[Plex Lib Count] Failed to get count for ${dir.title}:`,
                                    countError.message
                                );
                            // Continue without count
                        }

                        return {
                            key: dir.key,
                            name: dir.title,
                            type: dir.type, // 'movie', 'show', etc.
                            itemCount: itemCount,
                        };
                    })
                );

                if (isDebug) {
                    logger.debug(
                        `[Plex Lib Fetch] Returning ${libraries.length} libraries with counts:`,
                        {
                            libraries: libraries.map(l => ({
                                name: l.name,
                                type: l.type,
                                count: l.itemCount,
                            })),
                        }
                    );
                }

                res.json({ success: true, libraries });
            } catch (error) {
                if (isDebug) console.error('[Plex Lib Fetch] Failed:', error.message);
                let userMessage = 'Could not fetch libraries. Please check the connection details.';
                if (error.message.includes('401 Unauthorized')) {
                    userMessage = 'Unauthorized. Is the Plex token correct?';
                } else if (
                    error.code === 'ECONNREFUSED' ||
                    error.message.includes('ECONNREFUSED')
                ) {
                    userMessage = 'Connection refused. Is the hostname and port correct?';
                } else if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
                    userMessage = 'Connection timeout. Is the server reachable?';
                } else if (
                    error.message.includes('The string did not match the expected pattern')
                ) {
                    userMessage =
                        'Invalid hostname format. Use an IP address or hostname without http:// or https://.';
                }
                throw new ApiError(400, userMessage);
            }
        })
    );

    /**
     * @swagger
     * /api/admin/test-jellyfin:
     *   post:
     *     summary: Test connection to a Jellyfin server
     *     description: >
     *       Checks if the application can connect to a Jellyfin server with the provided
     *       hostname, port, and API key. This is a lightweight check that queries the system info.
     *     tags: ['Admin']
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               hostname:
     *                 type: string
     *                 description: Jellyfin server hostname or IP address
     *               port:
     *                 type: number
     *                 description: Jellyfin server port (typically 8096)
     *               apiKey:
     *                 type: string
     *                 description: Jellyfin API key
     *     responses:
     *       200:
     *         description: Connection successful.
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/AdminApiResponse'
     *       400:
     *         description: Connection error (e.g., incorrect credentials, timeout).
     */
    router.post(
        '/api/admin/test-jellyfin',
        isAuthenticated,
        asyncHandler(async (req, res) => {
            if (isDebug) logger.debug('[Admin API] Received request to test Jellyfin connection.');
            let { hostname, apiKey } = req.body; // apiKey is now optional
            const { port: portValue, insecureHttps } = req.body;

            if (!hostname || !portValue) {
                throw new ApiError(400, 'Hostname and port are required for the test.');
            }

            // Sanitize hostname to remove http(s):// prefix
            if (hostname) {
                hostname = hostname.trim().replace(/^https?:\/\//, '');
            }

            // If no API key is provided in the request, use the one from the server's config.
            if (!apiKey) {
                if (isDebug)
                    logger.debug(
                        '[Jellyfin Test] No API key provided in request, attempting to use existing server API key.'
                    );
                // Find any Jellyfin server config (enabled or disabled) to get the API key
                const jellyfinServerConfig = config.mediaServers.find(s => s.type === 'jellyfin');

                if (jellyfinServerConfig && jellyfinServerConfig.tokenEnvVar) {
                    apiKey = process.env[jellyfinServerConfig.tokenEnvVar];
                    if (isDebug) {
                        logger.debug(
                            `[Jellyfin Test] Found config with tokenEnvVar: ${jellyfinServerConfig.tokenEnvVar}`
                        );
                        logger.debug(
                            `[Jellyfin Test] process.env value exists: ${!!apiKey}, length: ${apiKey ? apiKey.length : 0}`
                        );
                        if (!apiKey) {
                            logger.debug(
                                `[Jellyfin Test] process.env.${jellyfinServerConfig.tokenEnvVar} is undefined, checking .env file...`
                            );
                        }
                    }
                    // Fallback: read from .env if process.env is not yet updated
                    if (!apiKey) {
                        try {
                            const envText = await readEnvFile();
                            if (isDebug) {
                                logger.debug(
                                    `[Jellyfin Test] Reading .env file, looking for ${jellyfinServerConfig.tokenEnvVar}`
                                );
                            }
                            const re = new RegExp(
                                `^${jellyfinServerConfig.tokenEnvVar}\\s*=\\s*"?([^"\n]*)"?`,
                                'm'
                            );
                            const m = envText.match(re);
                            if (m && m[1]) {
                                apiKey = m[1].trim();
                                // Update process.env for future use
                                process.env[jellyfinServerConfig.tokenEnvVar] = apiKey;
                                if (isDebug)
                                    logger.debug(
                                        `[Jellyfin Test] Successfully loaded ${jellyfinServerConfig.tokenEnvVar} from .env (len=${apiKey.length}).`
                                    );
                            } else {
                                if (isDebug) {
                                    logger.debug(
                                        `[Jellyfin Test] .env regex failed to match. Raw .env content for ${jellyfinServerConfig.tokenEnvVar}:`
                                    );
                                    const lines = envText
                                        .split('\n')
                                        .filter(line =>
                                            line.includes(jellyfinServerConfig.tokenEnvVar)
                                        );
                                    lines.forEach(line =>
                                        logger.debug(`[Jellyfin Test] .env line: "${line}"`)
                                    );

                                    // Try a more flexible regex
                                    const flexibleRe = new RegExp(
                                        `${jellyfinServerConfig.tokenEnvVar}\\s*=\\s*(.*)`,
                                        'm'
                                    );
                                    const flexMatch = envText.match(flexibleRe);
                                    if (flexMatch) {
                                        logger.debug(
                                            `[Jellyfin Test] Flexible regex matched: "${flexMatch[1]}"`
                                        );
                                        apiKey = flexMatch[1]
                                            .replace(/^["']/, '')
                                            .replace(/["']$/, '')
                                            .trim();
                                        process.env[jellyfinServerConfig.tokenEnvVar] = apiKey;
                                        logger.debug(
                                            `[Jellyfin Test] Used flexible parsing, got key (len=${apiKey.length})`
                                        );
                                    }
                                }
                            }
                        } catch (e) {
                            if (isDebug)
                                logger.debug('[Jellyfin Test] .env fallback failed:', e.message);
                        }
                    }
                    if (!apiKey) {
                        throw new ApiError(
                            400,
                            'Connection test failed: No new API key was provided, and no API key is configured on the server.'
                        );
                    }
                } else {
                    throw new ApiError(
                        400,
                        'Connection test failed: No API key provided and no Jellyfin server configuration found.'
                    );
                }
            }

            const port = parseInt(portValue, 10);
            if (isNaN(port) || port < 1 || port > 65535) {
                throw new ApiError(400, 'Port must be a valid number between 1 and 65535.');
            }

            try {
                if (isDebug) {
                    logger.debug(`[Jellyfin Test] About to create client with:`);
                    logger.debug(`[Jellyfin Test] - hostname: ${hostname}`);
                    logger.debug(`[Jellyfin Test] - port: ${port}`);
                    logger.debug(`[Jellyfin Test] - apiKey length: ${apiKey ? apiKey.length : 0}`);
                    logger.debug(
                        `[Jellyfin Test] - insecureHttps: ${typeof insecureHttps !== 'undefined' ? !!insecureHttps : process.env.JELLYFIN_INSECURE_HTTPS === 'true'}`
                    );
                }
                const client = await createJellyfinClient({
                    hostname,
                    port,
                    apiKey,
                    timeout: 6000,
                    insecureHttps:
                        typeof insecureHttps !== 'undefined'
                            ? !!insecureHttps
                            : process.env.JELLYFIN_INSECURE_HTTPS === 'true',
                    retryMaxRetries: 0,
                    retryBaseDelay: 300,
                });

                // Test connection with our HTTP client
                const info = await client.testConnection();

                res.json({
                    success: true,
                    message: 'Jellyfin connection successful.',
                    serverInfo: {
                        name: info.serverName,
                        version: info.version,
                    },
                });
            } catch (error) {
                if (isDebug) console.error('[Jellyfin Test] Failed:', error.message);
                let userMessage =
                    'Could not connect to Jellyfin. Please check the connection details.';
                if (error.message.includes('401') || error.message.includes('Unauthorized')) {
                    userMessage = 'Unauthorized. Is the API key correct?';
                } else if (error.code === 'EJELLYFIN_NOT_FOUND' || /404/.test(error.message)) {
                    userMessage =
                        'Not found. If Jellyfin is behind a base path (e.g. /jellyfin), include it in the hostname field.';
                } else if (error.code === 'EJELLYFIN_CERT') {
                    userMessage =
                        'TLS certificate error. If using a self-signed cert, enable Insecure HTTPS for the test.';
                } else if (
                    error.code === 'ECONNREFUSED' ||
                    error.message.includes('ECONNREFUSED')
                ) {
                    userMessage = 'Connection refused. Is the hostname and port correct?';
                } else if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
                    userMessage = 'Connection timeout. Is the server reachable?';
                } else if (
                    error.message.includes('The string did not match the expected pattern')
                ) {
                    userMessage =
                        'Invalid hostname format. Use an IP address or hostname without http:// or https://.';
                }
                throw new ApiError(400, userMessage);
            }
        })
    );

    return router;
};
