/**
 * Swagger/OpenAPI configuration for posterrama.app
 * This file uses swagger-jsdoc to generate an OpenAPI specification from JSDoc comments
 * in the source code. This specification is then used by swagger-ui-express to render
 * the interactive API documentation at the /api-docs endpoint.
 */

const swaggerJSDoc = require('swagger-jsdoc');

// Function to generate swagger spec with current package.json version
function generateSwaggerSpec() {
    // Always read fresh package.json to avoid caching issues
    delete require.cache[require.resolve('./package.json')];
    const pkg = require('./package.json');

    const options = {
        definition: {
            openapi: '3.0.0',
            info: {
                title: 'Posterrama API',
                version: pkg.version,
                description:
                    'API documentation for the posterrama.app screensaver application. This documents the public API used by the frontend to retrieve media and configuration.',
                contact: {
                    name: 'Posterrama',
                    url: 'https://github.com/Posterrama/posterrama',
                },
                license: {
                    name: 'GPL-3.0-or-later',
                    url: 'https://www.gnu.org/licenses/gpl-3.0.html',
                },
            },
            tags: [
                {
                    name: 'Public API',
                    description:
                        'Endpoints available to the frontend client without authentication.',
                },
                {
                    name: 'Admin API',
                    description:
                        'Secured endpoints for managing the application. Requires an active admin session.',
                },
                {
                    name: 'Admin Authentication',
                    description: 'Admin user authentication and authorization endpoints.',
                },
                {
                    name: 'Authentication',
                    description: 'General authentication and authorization endpoints.',
                },
                {
                    name: 'Admin Panel',
                    description: 'Admin panel interface and management endpoints.',
                },
                {
                    name: 'Admin Setup',
                    description: 'Initial admin setup and configuration endpoints.',
                },
                {
                    name: 'Configuration',
                    description: 'Application configuration management endpoints.',
                },
                {
                    name: 'Validation',
                    description: 'Configuration and data validation endpoints.',
                },
                {
                    name: 'Testing',
                    description: 'Development and testing endpoints.',
                },
                {
                    name: 'Metrics',
                    description: 'Performance monitoring and metrics endpoints.',
                },
                {
                    name: 'Frontend',
                    description: 'Frontend asset serving, templates and static pages.',
                },
                {
                    name: 'Cache',
                    description: 'Cache management and configuration endpoints.',
                },
                {
                    name: 'GitHub Integration',
                    description: 'GitHub API integration for releases and updates.',
                },
                {
                    name: 'Auto-Update',
                    description: 'Automatic application update management endpoints.',
                },
                {
                    name: 'Documentation',
                    description: 'API documentation and specification endpoints.',
                },
                {
                    name: 'Security',
                    description: 'Security monitoring and violation reporting endpoints.',
                },
                {
                    name: 'Site Server',
                    description: 'Public-facing site server endpoints and routes.',
                },
            ],
            servers: [
                {
                    url: '/',
                    description: 'Current server',
                },
            ],
            components: {
                securitySchemes: {
                    sessionAuth: {
                        type: 'apiKey',
                        in: 'cookie',
                        name: 'connect.sid',
                        description: 'Session-based authentication using cookies',
                    },
                },
                schemas: {
                    Config: {
                        type: 'object',
                        properties: {
                            clockWidget: {
                                type: 'boolean',
                                description: 'Whether the clock widget is enabled.',
                            },
                            transitionIntervalSeconds: {
                                type: 'integer',
                                description: 'Time in seconds between media transitions.',
                            },
                            backgroundRefreshMinutes: {
                                type: 'integer',
                                description:
                                    'How often the media playlist is refreshed from the server.',
                            },
                            showClearLogo: {
                                type: 'boolean',
                                description: 'Whether the ClearLogo image should be displayed.',
                            },
                            showPoster: {
                                type: 'boolean',
                                description: 'Whether the poster image should be displayed.',
                            },
                            showMetadata: {
                                type: 'boolean',
                                description:
                                    'Whether metadata text (tagline, year, etc.) should be displayed.',
                            },
                            showRottenTomatoes: {
                                type: 'boolean',
                                description:
                                    'Whether the Rotten Tomatoes badge should be displayed.',
                            },
                            rottenTomatoesMinimumScore: {
                                type: 'number',
                                description:
                                    'Minimum score (scale 0-10) for an item to be included if it has a Rotten Tomatoes rating. A value of 7.5 corresponds to 75%.',
                            },
                            kenBurnsEffect: {
                                type: 'object',
                                properties: {
                                    enabled: { type: 'boolean' },
                                    durationSeconds: { type: 'integer' },
                                },
                            },
                            isPublicSite: {
                                type: 'boolean',
                                description:
                                    'Flag indicating if this is the public site server (added by site server proxy).',
                            },
                        },
                    },
                    MediaItem: {
                        type: 'object',
                        properties: {
                            key: {
                                type: 'string',
                                description:
                                    'A unique identifier for the media item, composed of server type, name and item key.',
                            },
                            title: { type: 'string' },
                            backgroundUrl: {
                                type: 'string',
                                format: 'uri',
                                description:
                                    'URL to the background image, proxied through the app.',
                            },
                            posterUrl: {
                                type: 'string',
                                format: 'uri',
                                description: 'URL to the poster image, proxied through the app.',
                            },
                            clearLogoUrl: {
                                type: 'string',
                                format: 'uri',
                                nullable: true,
                                description: 'URL to the ClearLogo image, proxied through the app.',
                            },
                            tagline: { type: 'string', nullable: true },
                            rating: {
                                type: 'number',
                                nullable: true,
                                description: 'The general audience rating (e.g., 7.8).',
                            },
                            year: { type: 'integer', nullable: true },
                            imdbUrl: {
                                type: 'string',
                                format: 'uri',
                                nullable: true,
                                description: 'Direct link to the IMDb page for this item.',
                            },
                            rottenTomatoes: {
                                type: 'object',
                                nullable: true,
                                properties: {
                                    score: {
                                        type: 'integer',
                                        description: 'The Rotten Tomatoes score (0-100).',
                                    },
                                    icon: {
                                        type: 'string',
                                        enum: ['fresh', 'rotten', 'certified-fresh'],
                                        description: 'The corresponding RT icon.',
                                    },
                                    originalScore: {
                                        type: 'number',
                                        description:
                                            'The original score from the source (e.g., scale 0-10).',
                                    },
                                },
                            },
                            _raw: {
                                type: 'object',
                                description:
                                    'Raw metadata from the media server (only included in debug mode).',
                            },
                        },
                    },
                    ApiMessage: {
                        type: 'object',
                        properties: {
                            status: { type: 'string', example: 'building' },
                            message: {
                                type: 'string',
                                example:
                                    'Playlist is being built. Please try again in a few seconds.',
                            },
                            retryIn: { type: 'integer', example: 2000 },
                            error: { type: 'string' },
                        },
                    },
                    AdminApiResponse: {
                        type: 'object',
                        properties: {
                            success: { type: 'boolean', example: true },
                            message: { type: 'string' },
                            error: { type: 'string' },
                        },
                    },
                    PlexConnectionRequest: {
                        type: 'object',
                        required: ['hostname', 'port'],
                        properties: {
                            hostname: {
                                type: 'string',
                                description: 'The hostname or IP address of the Plex server.',
                                example: '192.168.1.10',
                            },
                            port: {
                                type: 'integer',
                                description: 'The port of the Plex server.',
                                example: 32400,
                            },
                            token: {
                                type: 'string',
                                description:
                                    'The Plex X-Plex-Token. Optional when testing, required when fetching libraries if none is configured.',
                            },
                        },
                    },
                    PlexLibrary: {
                        type: 'object',
                        properties: {
                            key: {
                                type: 'string',
                                description: 'The unique key of the library.',
                                example: '1',
                            },
                            name: {
                                type: 'string',
                                description: 'The name of the library.',
                                example: 'Movies',
                            },
                            type: {
                                type: 'string',
                                description: 'The type of the library.',
                                example: 'movie',
                                enum: ['movie', 'show', 'artist'],
                            },
                        },
                    },
                    PlexLibrariesResponse: {
                        type: 'object',
                        properties: {
                            success: { type: 'boolean', example: true },
                            libraries: {
                                type: 'array',
                                items: { $ref: '#/components/schemas/PlexLibrary' },
                            },
                        },
                    },
                    AdminConfigResponse: {
                        type: 'object',
                        properties: {
                            config: {
                                type: 'object',
                                description: 'The complete contents of config.json.',
                            },
                            env: {
                                type: 'object',
                                description: 'A selection of relevant environment variables.',
                            },
                            security: {
                                type: 'object',
                                properties: {
                                    is2FAEnabled: {
                                        type: 'boolean',
                                        description:
                                            'Indicates whether 2FA is enabled for the admin.',
                                    },
                                },
                            },
                        },
                    },
                    SaveConfigRequest: {
                        type: 'object',
                        properties: {
                            config: {
                                type: 'object',
                                description: 'The complete config.json object to save.',
                            },
                            env: {
                                type: 'object',
                                description: 'Key-value pairs of environment variables to save.',
                            },
                        },
                    },
                    ChangePasswordRequest: {
                        type: 'object',
                        required: ['currentPassword', 'newPassword', 'confirmPassword'],
                        properties: {
                            currentPassword: { type: 'string', format: 'password' },
                            newPassword: { type: 'string', format: 'password' },
                            confirmPassword: { type: 'string', format: 'password' },
                        },
                    },
                    Generate2FAResponse: {
                        type: 'object',
                        properties: {
                            qrCodeDataUrl: {
                                type: 'string',
                                format: 'uri',
                                description: 'A data URI of the QR code image that can be scanned.',
                            },
                        },
                    },
                    Verify2FARequest: {
                        type: 'object',
                        required: ['token'],
                        properties: {
                            token: {
                                type: 'string',
                                description: 'The 6-digit TOTP code from the authenticator app.',
                            },
                        },
                    },
                    Disable2FARequest: {
                        type: 'object',
                        required: ['password'],
                        properties: {
                            password: {
                                type: 'string',
                                format: 'password',
                                description: 'The current admin password of the user.',
                            },
                        },
                    },
                    DebugResponse: {
                        type: 'object',
                        properties: {
                            note: {
                                type: 'string',
                                description: 'A note about the contents of the response.',
                            },
                            playlist_item_count: {
                                type: 'integer',
                                description: 'The number of items in the current playlist cache.',
                            },
                            playlist_items_raw: {
                                type: 'array',
                                description:
                                    'An array of the raw media objects as received from the media server.',
                                items: {
                                    type: 'object',
                                },
                            },
                        },
                    },
                    ApiKeyResponse: {
                        type: 'object',
                        properties: {
                            apiKey: {
                                type: 'string',
                                description:
                                    'The newly generated API key. Will only be shown once.',
                            },
                            message: { type: 'string' },
                        },
                    },
                    RefreshMediaResponse: {
                        type: 'object',
                        properties: {
                            success: { type: 'boolean', example: true },
                            message: {
                                type: 'string',
                                example: 'Media playlist successfully refreshed. 150 items found.',
                            },
                            itemCount: {
                                type: 'integer',
                                example: 150,
                                description: 'Number of media items found after refresh.',
                            },
                        },
                    },
                    LogEntry: {
                        type: 'object',
                        properties: {
                            timestamp: { type: 'string', format: 'date-time' },
                            level: {
                                type: 'string',
                                enum: ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'],
                            },
                            message: { type: 'string' },
                        },
                    },
                    ErrorResponse: {
                        type: 'object',
                        properties: {
                            error: {
                                type: 'string',
                                description: 'Error message describing what went wrong.',
                            },
                        },
                    },
                    BasicHealthResponse: {
                        type: 'object',
                        required: ['status', 'service', 'version', 'timestamp', 'uptime'],
                        properties: {
                            status: {
                                type: 'string',
                                enum: ['ok'],
                                description: 'Service status',
                                example: 'ok',
                            },
                            service: {
                                type: 'string',
                                description: 'Service name',
                                example: 'posterrama',
                            },
                            version: {
                                type: 'string',
                                description: 'Service version',
                                example: '1.2.5',
                            },
                            timestamp: {
                                type: 'string',
                                format: 'date-time',
                                description: 'Current timestamp',
                                example: '2025-07-27T12:00:00Z',
                            },
                            uptime: {
                                type: 'number',
                                description: 'Process uptime in seconds',
                                example: 3600,
                            },
                        },
                    },
                    HealthCheckResult: {
                        type: 'object',
                        required: ['name', 'status', 'message'],
                        properties: {
                            name: {
                                type: 'string',
                                description: 'Name of the health check',
                                example: 'configuration',
                            },
                            status: {
                                type: 'string',
                                enum: ['ok', 'warning', 'error'],
                                description: 'Status of this specific check',
                                example: 'ok',
                            },
                            message: {
                                type: 'string',
                                description: 'A descriptive message about the check result',
                                example: 'Connection successful',
                            },
                            details: {
                                type: 'object',
                                description: 'Additional details about the check',
                            },
                        },
                    },
                    HealthCheckResponse: {
                        type: 'object',
                        required: ['status', 'timestamp', 'checks'],
                        properties: {
                            status: {
                                type: 'string',
                                enum: ['ok', 'warning', 'error'],
                                description: 'Overall health status of the application',
                                example: 'ok',
                            },
                            timestamp: {
                                type: 'string',
                                format: 'date-time',
                                description: 'Timestamp when the health check was performed',
                                example: '2025-07-27T12:00:00Z',
                            },
                            checks: {
                                type: 'array',
                                description: 'List of individual health check results',
                                items: { $ref: '#/components/schemas/HealthCheckResult' },
                            },
                        },
                    },
                    ValidationResponse: {
                        type: 'object',
                        properties: {
                            valid: { type: 'boolean', description: 'Whether the data is valid' },
                            message: { type: 'string', description: 'Validation result message' },
                            sanitized: {
                                type: 'object',
                                description: 'Sanitized data if validation passed',
                            },
                            errors: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'List of validation errors if any',
                            },
                        },
                    },
                    PlexTestResponse: {
                        type: 'object',
                        properties: {
                            success: {
                                type: 'boolean',
                                description: 'Whether the connection test was successful',
                            },
                            message: { type: 'string', description: 'Result message' },
                            serverInfo: {
                                type: 'object',
                                description: 'Plex server information if successful',
                            },
                        },
                    },
                    ApiKeyStatusResponse: {
                        type: 'object',
                        properties: {
                            hasApiKey: {
                                type: 'boolean',
                                description: 'Whether an API key is configured',
                            },
                            keyId: { type: 'string', description: 'ID of the current API key' },
                        },
                    },
                    MetricsResponse: {
                        type: 'object',
                        properties: {
                            performance: { type: 'object', description: 'Performance metrics' },
                            endpoints: { type: 'object', description: 'Endpoint usage metrics' },
                            system: { type: 'object', description: 'System resource metrics' },
                            cache: { type: 'object', description: 'Cache usage metrics' },
                        },
                    },
                    GenreResponse: {
                        type: 'object',
                        properties: {
                            success: {
                                type: 'boolean',
                                description: 'Whether the genre fetch was successful',
                            },
                            genres: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'List of available genres',
                            },
                        },
                    },
                    LoginRequest: {
                        type: 'object',
                        required: ['username', 'password'],
                        properties: {
                            username: {
                                type: 'string',
                                description: 'Username for authentication',
                            },
                            password: {
                                type: 'string',
                                format: 'password',
                                description: 'Password for authentication',
                            },
                        },
                    },
                    LoginResponse: {
                        type: 'object',
                        properties: {
                            success: {
                                type: 'boolean',
                                description: 'Whether login was successful',
                            },
                            requires2FA: {
                                type: 'boolean',
                                description: 'Whether 2FA verification is required',
                            },
                            redirectTo: {
                                type: 'string',
                                description: 'URL to redirect to after login',
                            },
                            message: { type: 'string', description: 'Login result message' },
                        },
                    },
                    SessionResponse: {
                        type: 'object',
                        properties: {
                            sessions: {
                                type: 'array',
                                description: 'List of active user sessions',
                            },
                        },
                    },
                    TMDBConnectionRequest: {
                        type: 'object',
                        required: ['apiKey'],
                        properties: {
                            apiKey: {
                                type: 'string',
                                description: 'The TMDB API key',
                            },
                        },
                    },
                    TMDBGenresResponse: {
                        type: 'object',
                        properties: {
                            success: { type: 'boolean', example: true },
                            genres: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'List of TMDB genres',
                            },
                        },
                    },
                    PlexGenresResponse: {
                        type: 'object',
                        properties: {
                            success: { type: 'boolean', example: true },
                            genres: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'List of Plex genres',
                            },
                        },
                    },
                    GitHubRelease: {
                        type: 'object',
                        properties: {
                            id: { type: 'integer' },
                            tag_name: { type: 'string' },
                            name: { type: 'string' },
                            body: { type: 'string' },
                            published_at: { type: 'string', format: 'date-time' },
                            prerelease: { type: 'boolean' },
                        },
                    },
                    GitHubReleaseResponse: {
                        type: 'object',
                        properties: {
                            success: { type: 'boolean', example: true },
                            release: { $ref: '#/components/schemas/GitHubRelease' },
                        },
                    },
                    UpdateCheckResponse: {
                        type: 'object',
                        properties: {
                            success: { type: 'boolean', example: true },
                            hasUpdate: { type: 'boolean' },
                            currentVersion: { type: 'string' },
                            latestVersion: { type: 'string' },
                            releaseInfo: { $ref: '#/components/schemas/GitHubRelease' },
                        },
                    },
                },
            },
        },
        apis: ['./server.js'], // Path to files with OpenAPI definitions
    };

    return swaggerJSDoc(options);
}

// Generate and export swagger spec
module.exports = generateSwaggerSpec();
