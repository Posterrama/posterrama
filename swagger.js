/**
 * OpenAPI/Swagger specification for Posterrama API
 * This specification is generated dynamically from JSDoc comments in route definitions
 * in the source code. This specification is then used by ReDoc to render
 * interactive API documentation at /api-docs.
 */

const swaggerJSDoc = require('swagger-jsdoc');

// Function to generate swagger spec with current package.json version and optional dynamic server URL
function generateSwaggerSpec(req = null) {
    // Always read fresh package.json to avoid caching issues
    delete require.cache[require.resolve('./package.json')];
    const pkg = require('./package.json');

    // Determine server URL from request or fallback to localhost
    let primaryServerUrl = 'http://localhost:4000';
    let primaryServerDescription = 'Development server (default port 4000)';

    if (req) {
        const protocol = req.protocol || 'http';
        const host = req.get('host') || 'localhost:4000';
        primaryServerUrl = `${protocol}://${host}`;
        primaryServerDescription = 'Current server (auto-detected from request)';
    }

    const options = {
        definition: {
            openapi: '3.0.0',
            info: {
                title: 'Posterrama API',
                version: pkg.version,
                description:
                    'Posterrama aggregates media from Plex, Jellyfin, TMDB, RomM, and local libraries to create dynamic poster galleries.',
                contact: {
                    name: 'Posterrama Project',
                    url: 'https://github.com/Posterrama/posterrama',
                    email: 'support@posterrama.app',
                },
                'x-logo': {
                    url: 'https://github.com/Posterrama/posterrama',
                    altText: 'GitHub Repository',
                },
                license: {
                    name: 'GPL-3.0-or-later',
                    url: 'https://www.gnu.org/licenses/gpl-3.0.html',
                },
            },
            externalDocs: {
                description: 'Full documentation, setup guides, and tutorials',
                url: 'https://github.com/Posterrama/posterrama/tree/main/docs',
            },
            servers: [
                {
                    url: primaryServerUrl,
                    description: primaryServerDescription,
                },
                {
                    url: 'http://localhost:4000',
                    description: 'Development server (default port 4000)',
                },
                {
                    url: 'http://{host}:{port}',
                    description: 'Custom deployment',
                    variables: {
                        host: {
                            default: 'localhost',
                            description: 'Server hostname or IP address',
                        },
                        port: {
                            default: '4000',
                            description: 'Server port (configured via PORT env variable)',
                        },
                    },
                },
            ],
            tags: [
                {
                    name: 'API v1',
                    description:
                        '**Modern RESTful API** (Preferred) - Clean, versioned endpoints following REST best practices. Use these for all new integrations. Includes `/api/v1/config`, `/api/v1/media`, `/api/v1/media/{key}`, `/api/v1/devices/*`.',
                    externalDocs: {
                        description: 'API v1 Documentation',
                        url: 'https://github.com/Posterrama/posterrama/blob/main/docs/API-PRODUCTION-READINESS.md',
                    },
                },
                {
                    name: 'Public API',
                    description:
                        '**Core endpoints** for fetching media and configuration. No authentication required. Examples: GET /get-media, GET /health',
                    externalDocs: {
                        description: 'API Usage Examples',
                        url: 'https://github.com/Posterrama/posterrama#api-usage',
                    },
                },
                {
                    name: 'Frontend',
                    description:
                        '**Display pages** (/screensaver, /cinema, /wallart) and admin interface (/admin). Returns HTML with embedded configurations.',
                },
                {
                    name: 'Authentication',
                    description:
                        '**Session-based auth** with optional 2FA. Login flow: POST /login → Cookie → POST /logout. Supports Bearer tokens for API access.',
                },
                {
                    name: 'Security',
                    description:
                        '**Security monitoring** including CSP violation reporting, rate limiting, and login attempt tracking. Admin-only endpoints.',
                },
                {
                    name: 'Admin',
                    description:
                        '**System management** including config backups, server restarts, and health monitoring. All endpoints require sessionAuth or bearerAuth.',
                },
                {
                    name: 'Configuration',
                    description:
                        '**Application settings** for media sources (Plex/Jellyfin/TMDB), display modes (screensaver/cinema/wallart), and server options. Supports config backups.',
                },
                {
                    name: 'Validation',
                    description:
                        '**Test connections** to Plex/Jellyfin/TMDB servers before saving config. Returns detailed error messages on failure.',
                },
                {
                    name: 'Devices',
                    description:
                        '**Device lifecycle** → Register POST /api/devices/register, pair with code POST /api/devices/pair, control via WebSocket /ws/devices. Rate limited: 5 req/min.',
                },
                {
                    name: 'Groups',
                    description:
                        '**Device grouping** for broadcast control. Create groups POST /api/groups, assign devices, send commands to all members simultaneously.',
                },
                {
                    name: 'Local Directory',
                    description:
                        '**Offline media** from ZIP posterpack archives or directory scans. Upload POST /local-posterpack/upload, list GET /local-posterpack/:zipName/list.',
                },
                {
                    name: 'Cache',
                    description:
                        '**Performance optimization** with multi-tier caching (memory + disk). View stats GET /api/cache/stats, clear cache POST /api/cache/clear.',
                },
                {
                    name: 'Metrics',
                    description:
                        '**System monitoring** → Source performance (Plex/Jellyfin/TMDB response times), cache hit rates, device status. Useful for diagnostics.',
                },
                {
                    name: 'Auto-Update',
                    description:
                        '**GitHub Releases integration** for automatic updates via PM2. Check GET /api/github/latest, apply POST /api/admin/github/update.',
                },
                {
                    name: 'GitHub Integration',
                    description:
                        '**Release management** → Fetch releases GET /api/admin/github/releases, trigger updates. Uses GitHub API with rate limiting (60 req/hour).',
                },
                {
                    name: 'Documentation',
                    description:
                        '**API reference** at /api-docs (ReDoc). Download OpenAPI spec GET /api-docs/swagger.json.',
                },
                {
                    name: 'Site Server',
                    description:
                        '**Static assets** including favicon, manifest, robots.txt. Supports PWA installation.',
                },
            ],
            'x-tagGroups': [
                {
                    name: 'Modern API (Recommended)',
                    tags: ['API v1'],
                },
                {
                    name: 'Core API',
                    tags: ['Public API', 'Frontend'],
                },
                {
                    name: 'Authentication & Security',
                    tags: ['Authentication', 'Security'],
                },
                {
                    name: 'Admin & Configuration',
                    tags: ['Admin', 'Configuration', 'Validation'],
                },
                {
                    name: 'Device Management',
                    tags: ['Devices', 'Groups'],
                },
                {
                    name: 'Media Sources',
                    tags: ['Local Directory'],
                },
                {
                    name: 'System Monitoring',
                    tags: ['Cache', 'Metrics'],
                },
                {
                    name: 'Updates & Integrations',
                    tags: ['Auto-Update', 'GitHub Integration'],
                },
                {
                    name: 'Utilities',
                    tags: ['Documentation', 'Site Server'],
                },
            ],
            components: {
                securitySchemes: {
                    sessionAuth: {
                        type: 'apiKey',
                        in: 'cookie',
                        name: 'connect.sid',
                        description:
                            'Session-based authentication using HTTP cookies. Used by the admin web interface. Login via POST /admin/login to receive session cookie.',
                    },
                    bearerAuth: {
                        type: 'http',
                        scheme: 'bearer',
                        bearerFormat: 'API-Key',
                        description:
                            'Bearer token authentication for programmatic API access. Include API key in Authorization header: "Authorization: Bearer YOUR_API_KEY". Configure API keys in admin settings.',
                    },
                },
                schemas: {
                    StandardOkResponse: {
                        type: 'object',
                        properties: {
                            ok: { type: 'boolean', example: true },
                        },
                        example: { ok: true },
                    },
                    StandardErrorResponse: {
                        type: 'object',
                        properties: {
                            error: {
                                type: 'string',
                                description: 'Error message describing what went wrong',
                                example: 'Invalid request parameters',
                            },
                            message: {
                                type: 'string',
                                description: 'Additional error details (optional)',
                                example: 'The count parameter must be between 1 and 500',
                            },
                            statusCode: {
                                type: 'integer',
                                description: 'HTTP status code',
                                example: 400,
                            },
                        },
                        required: ['error'],
                        example: {
                            error: 'Invalid request parameters',
                            message: 'The count parameter must be between 1 and 500',
                            statusCode: 400,
                        },
                    },
                    BackupCreateResponse: {
                        type: 'object',
                        properties: {
                            ok: { type: 'boolean', example: true },
                            backup: { $ref: '#/components/schemas/BackupRecord' },
                        },
                        example: {
                            ok: true,
                            backup: {
                                id: 'config-backup-1730000000000',
                                createdAt: '2025-10-25T12:00:00.000Z',
                                sizeBytes: 4096,
                                type: 'manual',
                                label: 'Pre-upgrade backup',
                                note: 'Created before testing new features',
                            },
                        },
                    },
                    BackupRecord: {
                        type: 'object',
                        properties: {
                            id: {
                                type: 'string',
                                description: 'Backup identifier (filename or UUID)',
                            },
                            createdAt: { type: 'string', format: 'date-time' },
                            sizeBytes: { type: 'integer' },
                            type: {
                                type: 'string',
                                description: 'backup type (manual|auto|upgrade)',
                            },
                            label: {
                                type: 'string',
                                maxLength: 100,
                                description: 'Optional custom label for this backup',
                            },
                            note: {
                                type: 'string',
                                maxLength: 500,
                                description: 'Optional detailed note about this backup',
                            },
                        },
                    },
                    BackupListResponse: {
                        type: 'object',
                        properties: {
                            ok: { type: 'boolean' },
                            backups: {
                                type: 'array',
                                items: { $ref: '#/components/schemas/BackupRecord' },
                            },
                        },
                        example: {
                            ok: true,
                            backups: [
                                {
                                    id: 'config-backup-1730000000000',
                                    createdAt: '2025-10-25T12:00:00.000Z',
                                    sizeBytes: 4096,
                                    type: 'manual',
                                    label: 'Before v2.9.5 update',
                                    note: 'Stable configuration before major update',
                                },
                                {
                                    id: 'config-backup-1729950000000',
                                    createdAt: '2025-10-24T23:00:00.000Z',
                                    sizeBytes: 4102,
                                    type: 'auto',
                                },
                            ],
                        },
                    },
                    BackupCleanupResponse: {
                        type: 'object',
                        properties: {
                            ok: { type: 'boolean' },
                            removed: { type: 'integer' },
                            retained: { type: 'integer' },
                        },
                        example: {
                            ok: true,
                            removed: 5,
                            retained: 10,
                        },
                    },
                    BackupRestoreResponse: {
                        type: 'object',
                        properties: {
                            ok: { type: 'boolean' },
                            restored: { type: 'boolean' },
                            backup: { $ref: '#/components/schemas/BackupRecord' },
                        },
                        example: {
                            ok: true,
                            restored: true,
                            backup: {
                                id: 'config-backup-1730000000000',
                                createdAt: '2025-10-25T12:00:00.000Z',
                                sizeBytes: 4096,
                                type: 'manual',
                            },
                        },
                    },
                    BackupDeleteResponse: {
                        type: 'object',
                        properties: {
                            ok: { type: 'boolean' },
                            deleted: { type: 'boolean' },
                            id: { type: 'string' },
                        },
                        example: {
                            ok: true,
                            deleted: true,
                            id: 'config-backup-1730000000000',
                        },
                    },
                    BackupUpdateResponse: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            createdAt: { type: 'string', format: 'date-time' },
                            files: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        name: { type: 'string' },
                                        size: { type: 'integer' },
                                    },
                                },
                            },
                            label: { type: 'string', maxLength: 100 },
                            note: { type: 'string', maxLength: 500 },
                        },
                        example: {
                            id: 'config-backup-1730000000000',
                            createdAt: '2025-10-25T12:00:00.000Z',
                            files: [{ name: 'config.json', size: 4096 }],
                            label: 'Updated label',
                            note: 'Updated note with more details',
                        },
                    },
                    BackupSchedule: {
                        type: 'object',
                        properties: {
                            enabled: { type: 'boolean' },
                            time: {
                                type: 'string',
                                pattern: '^\\d{1,2}:\\d{2}$',
                                description: 'Daily backup time in HH:MM format (24-hour)',
                            },
                            retention: {
                                type: 'integer',
                                minimum: 1,
                                maximum: 60,
                                description: 'Number of backups to retain',
                            },
                            retentionDays: {
                                type: 'integer',
                                minimum: 0,
                                maximum: 365,
                                description:
                                    'Delete backups older than this many days (0 = disabled)',
                            },
                        },
                    },
                    BackupScheduleResponse: {
                        type: 'object',
                        properties: {
                            ok: { type: 'boolean' },
                            schedule: { $ref: '#/components/schemas/BackupSchedule' },
                        },
                        example: {
                            ok: true,
                            schedule: {
                                enabled: true,
                                time: '02:30',
                                retention: 5,
                                retentionDays: 30,
                            },
                        },
                    },
                    NotificationTestRequest: {
                        type: 'object',
                        properties: {
                            level: {
                                type: 'string',
                                enum: ['info', 'warn', 'error'],
                                default: 'warn',
                                description: 'Notification severity level',
                            },
                            message: {
                                type: 'string',
                                minLength: 1,
                                maxLength: 500,
                                description: 'Test notification message (1-500 characters)',
                            },
                        },
                        example: {
                            level: 'warn',
                            message: 'This is a test notification from Posterrama',
                        },
                    },
                    NotificationTestResponse: {
                        type: 'object',
                        properties: {
                            ok: { type: 'boolean' },
                            level: { type: 'string' },
                            message: { type: 'string' },
                        },
                        example: {
                            ok: true,
                            level: 'warn',
                            message: 'Test notification sent successfully',
                        },
                    },
                    PaginatedMediaResponse: {
                        type: 'object',
                        description: 'Generic paginated media list wrapper',
                        properties: {
                            ok: { type: 'boolean', example: true },
                            total: {
                                type: 'integer',
                                description: 'Total items available (may be capped)',
                                example: 150,
                            },
                            page: {
                                type: 'integer',
                                description: 'Current page index (1-based)',
                                example: 1,
                            },
                            pageSize: {
                                type: 'integer',
                                description: 'Requested page size',
                                example: 20,
                            },
                            items: {
                                type: 'array',
                                description: 'Media items (shape depends on source aggregation)',
                                items: { type: 'object' },
                            },
                        },
                        example: {
                            ok: true,
                            total: 150,
                            page: 1,
                            pageSize: 20,
                            items: [],
                        },
                    },
                    // TODO(new-source): If your new source exposes new request/response shapes
                    // add minimal schemas here and reference them from JSDoc blocks in server.js.
                    // --- Device Management ---
                    Device: {
                        type: 'object',
                        properties: {
                            id: { type: 'string', description: 'Unique device identifier' },
                            name: { type: 'string', description: 'Human-friendly name' },
                            location: { type: 'string', description: 'Optional physical location' },
                            tags: {
                                type: 'array',
                                description: 'Custom device tags',
                                items: { type: 'string' },
                            },
                            groups: {
                                type: 'array',
                                description: 'Assigned group IDs',
                                items: { type: 'string' },
                            },
                            installId: {
                                type: 'string',
                                nullable: true,
                                description: 'Browser/session install identifier (nullable)',
                            },
                            hardwareId: {
                                type: 'string',
                                nullable: true,
                                description: 'Stable hardware identifier when available (nullable)',
                            },
                            createdAt: { type: 'string', format: 'date-time' },
                            updatedAt: { type: 'string', format: 'date-time' },
                            lastSeenAt: { type: 'string', format: 'date-time', nullable: true },
                            status: {
                                type: 'string',
                                description: 'Reported status',
                                enum: ['unknown', 'online', 'offline'],
                            },
                            clientInfo: {
                                type: 'object',
                                properties: {
                                    userAgent: { type: 'string' },
                                    screen: {
                                        type: 'object',
                                        properties: {
                                            w: { type: 'integer' },
                                            h: { type: 'integer' },
                                            dpr: { type: 'number' },
                                        },
                                    },
                                    mode: { type: 'string' },
                                },
                            },
                            settingsOverride: {
                                type: 'object',
                                description: 'Per-device settings override payload',
                            },
                            preset: { type: 'string', description: 'Optional preset name' },
                            currentState: {
                                type: 'object',
                                properties: {
                                    mediaId: { type: 'string', nullable: true },
                                    paused: { type: 'boolean', nullable: true },
                                    pinned: { type: 'boolean', nullable: true },
                                    pinMediaId: { type: 'string', nullable: true },
                                    poweredOff: { type: 'boolean', nullable: true },
                                },
                            },
                            wsConnected: {
                                type: 'boolean',
                                description: 'Derived flag indicating active WebSocket connection',
                            },
                        },
                    },
                    DeviceRegisterRequest: {
                        type: 'object',
                        properties: {
                            name: { type: 'string' },
                            location: { type: 'string' },
                            installId: { type: 'string', nullable: true },
                            hardwareId: { type: 'string', nullable: true },
                        },
                    },
                    DeviceRegisterResponse: {
                        type: 'object',
                        required: ['deviceId', 'deviceSecret'],
                        properties: {
                            deviceId: { type: 'string', example: 'dev_abc123xyz' },
                            deviceSecret: {
                                type: 'string',
                                example: '$2b$10$abcdefghijklmnopqrstuvwxyz1234567890',
                                description: 'Bcrypt hashed secret - store securely',
                            },
                        },
                        example: {
                            deviceId: 'dev_abc123xyz',
                            deviceSecret: '$2b$10$abcdefghijklmnopqrstuvwxyz1234567890',
                        },
                    },
                    DeviceQueuedCommand: {
                        type: 'object',
                        properties: {
                            id: { type: 'string', description: 'Server-assigned queue id' },
                            type: { type: 'string' },
                            payload: { type: 'object' },
                        },
                    },
                    DeviceHeartbeatRequest: {
                        type: 'object',
                        required: ['deviceId', 'deviceSecret'],
                        properties: {
                            deviceId: { type: 'string' },
                            deviceSecret: { type: 'string' },
                            userAgent: { type: 'string' },
                            screen: {
                                type: 'object',
                                properties: {
                                    w: { type: 'integer' },
                                    h: { type: 'integer' },
                                    dpr: { type: 'number' },
                                },
                            },
                            mode: { type: 'string' },
                            mediaId: { type: 'string' },
                            paused: { type: 'boolean' },
                            pinned: { type: 'boolean' },
                            pinMediaId: { type: 'string' },
                            poweredOff: { type: 'boolean' },
                            installId: { type: 'string' },
                            hardwareId: { type: 'string' },
                        },
                    },
                    DeviceHeartbeatResponse: {
                        type: 'object',
                        properties: {
                            serverTime: { type: 'integer', example: 1730000000000 },
                            commandsQueued: {
                                type: 'array',
                                items: { $ref: '#/components/schemas/DeviceQueuedCommand' },
                            },
                        },
                        example: {
                            serverTime: 1730000000000,
                            commandsQueued: [],
                        },
                    },
                    PairingCodeRequest: {
                        type: 'object',
                        properties: {
                            ttlMs: {
                                type: 'integer',
                                description: 'TTL in milliseconds (min 60000, max 3600000)',
                                example: 600000,
                            },
                        },
                    },
                    PairingCodeResponse: {
                        type: 'object',
                        properties: {
                            code: {
                                type: 'string',
                                description: 'Numeric pairing code',
                                example: '123456',
                            },
                            token: {
                                type: 'string',
                                description: 'One-time token (only shown once) for added security',
                                example: 'tok_abc123xyz789',
                            },
                            expiresAt: {
                                type: 'string',
                                format: 'date-time',
                                example: '2025-10-25T12:10:00.000Z',
                            },
                        },
                        example: {
                            code: '123456',
                            token: 'tok_abc123xyz789',
                            expiresAt: '2025-10-25T12:10:00.000Z',
                        },
                    },
                    PairingClaimRequest: {
                        type: 'object',
                        required: ['code'],
                        properties: {
                            code: { type: 'string' },
                            token: {
                                type: 'string',
                                description: 'Token from PairingCodeResponse',
                            },
                            name: { type: 'string' },
                            location: { type: 'string' },
                        },
                    },
                    PairingClaimResponse: {
                        type: 'object',
                        properties: {
                            deviceId: { type: 'string' },
                            deviceSecret: { type: 'string' },
                        },
                    },
                    DeviceCommandRequest: {
                        type: 'object',
                        required: ['type'],
                        properties: {
                            type: {
                                type: 'string',
                                description: 'Command type (e.g., reload, clear-cache, next, prev)',
                            },
                            payload: { type: 'object' },
                        },
                    },
                    DeviceCommandResponse: {
                        type: 'object',
                        properties: {
                            queued: { type: 'boolean' },
                            live: { type: 'boolean' },
                            command: { $ref: '#/components/schemas/DeviceQueuedCommand' },
                        },
                    },
                    DeviceCommandAck: {
                        type: 'object',
                        properties: {
                            status: { type: 'string', enum: ['ok', 'timeout', 'error'] },
                            info: { type: 'object', nullable: true },
                        },
                    },
                    Group: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            name: { type: 'string' },
                            description: { type: 'string' },
                            settingsTemplate: {
                                type: 'object',
                                description: 'Settings template applied to group members',
                            },
                            order: { type: 'integer', description: 'Sort order (ascending)' },
                        },
                    },
                    GroupCommandResult: {
                        type: 'object',
                        properties: {
                            deviceId: { type: 'string' },
                            status: {
                                type: 'string',
                                description: 'Per-device status',
                                enum: ['ok', 'timeout', 'queued', 'error'],
                            },
                            detail: { type: 'string', nullable: true },
                        },
                    },
                    DevicePatchRequest: {
                        type: 'object',
                        properties: {
                            name: { type: 'string' },
                            location: { type: 'string' },
                            tags: { type: 'array', items: { type: 'string' } },
                            groups: { type: 'array', items: { type: 'string' } },
                            settingsOverride: { type: 'object' },
                            preset: { type: 'string' },
                        },
                    },
                    GroupCreateRequest: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            name: { type: 'string' },
                            description: { type: 'string' },
                            settingsTemplate: { type: 'object' },
                            order: { type: 'integer' },
                        },
                    },
                    GroupPatchRequest: {
                        type: 'object',
                        properties: {
                            name: { type: 'string' },
                            description: { type: 'string' },
                            settingsTemplate: { type: 'object' },
                            order: { type: 'integer' },
                        },
                    },
                    DeviceMergeRequest: {
                        type: 'object',
                        required: ['sourceIds'],
                        properties: {
                            sourceIds: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'IDs of devices to merge into target',
                            },
                        },
                    },
                    GroupCommandResponse: {
                        type: 'object',
                        properties: {
                            ok: { type: 'boolean' },
                            live: { type: 'integer' },
                            queued: { type: 'integer' },
                            total: { type: 'integer' },
                            results: {
                                type: 'array',
                                items: { $ref: '#/components/schemas/GroupCommandResult' },
                            },
                        },
                    },
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
                        description:
                            'A media item from any source (Plex, Jellyfin, TMDB, or Local). Contains all metadata needed to display the poster and additional information.',
                        properties: {
                            key: {
                                type: 'string',
                                description:
                                    'A unique identifier for the media item, composed of source type, server name, and item ID (e.g., "plex-MyServer-12345", "jellyfin-Home-67890", "tmdb-movie-550").',
                                example: 'plex-MyPlexServer-12345',
                            },
                            title: {
                                type: 'string',
                                description: 'Title of the movie or TV show',
                                example: 'Blade Runner 2049',
                            },
                            backgroundUrl: {
                                type: 'string',
                                format: 'uri',
                                description:
                                    'URL to the background/backdrop image, proxied through /proxy endpoint to hide server details.',
                                example:
                                    '/proxy?server=MyPlexServer&path=/library/metadata/12345/art/1234567890',
                            },
                            posterUrl: {
                                type: 'string',
                                format: 'uri',
                                description:
                                    'URL to the poster image, proxied through /proxy endpoint.',
                                example:
                                    '/proxy?server=MyPlexServer&path=/library/metadata/12345/thumb/1234567890',
                            },
                            thumbnailUrl: {
                                type: 'string',
                                format: 'uri',
                                nullable: true,
                                description:
                                    'URL to a smaller thumbnail image when available (primarily from Local posterpacks). Useful for gallery views.',
                                example:
                                    '/local-posterpack?zip=complete/plex-export/Blade%20Runner%202049%20(2017).zip&entry=thumbnail',
                            },
                            clearLogoUrl: {
                                type: 'string',
                                format: 'uri',
                                nullable: true,
                                description:
                                    'URL to the ClearLogo image (transparent logo), proxied through the app. Great for overlays.',
                                example:
                                    '/proxy?server=MyPlexServer&path=/library/metadata/12345/clearlogo',
                            },
                            tagline: {
                                type: 'string',
                                nullable: true,
                                description: 'Movie tagline or short description',
                                example: 'The key to the future is finally unearthed.',
                            },
                            rating: {
                                type: 'number',
                                nullable: true,
                                description:
                                    'The general audience rating on a scale (typically 0-10).',
                                example: 8.0,
                            },
                            year: {
                                type: 'integer',
                                nullable: true,
                                description: 'Release year',
                                example: 2017,
                            },
                            imdbUrl: {
                                type: 'string',
                                format: 'uri',
                                nullable: true,
                                description: 'Direct link to the IMDb page for this item.',
                                example: 'https://www.imdb.com/title/tt1856101/',
                            },
                            rottenTomatoes: {
                                type: 'object',
                                nullable: true,
                                description: 'Rotten Tomatoes score information when available',
                                properties: {
                                    score: {
                                        type: 'integer',
                                        description: 'The Rotten Tomatoes score (0-100).',
                                        example: 88,
                                    },
                                    icon: {
                                        type: 'string',
                                        enum: ['fresh', 'rotten', 'certified-fresh'],
                                        description: 'The corresponding RT freshness icon.',
                                        example: 'certified-fresh',
                                    },
                                    originalScore: {
                                        type: 'number',
                                        description:
                                            'The original score from the source before conversion to 0-100 scale.',
                                        example: 8.8,
                                    },
                                },
                            },
                            extras: {
                                type: 'array',
                                nullable: true,
                                description:
                                    'Array of extras (trailers, behind the scenes, deleted scenes, interviews, etc.). Only populated when includeExtras=true query parameter is set. Available for Plex and Jellyfin sources only.',
                                items: {
                                    type: 'object',
                                    properties: {
                                        type: {
                                            type: 'string',
                                            description: 'Type of extra content',
                                            example: 'clip',
                                            enum: [
                                                'clip',
                                                'behindTheScenes',
                                                'deletedScene',
                                                'interview',
                                                'sceneOrSample',
                                                'featurette',
                                                'short',
                                            ],
                                        },
                                        title: {
                                            type: 'string',
                                            description: 'Title of the extra',
                                            example: 'Official Trailer',
                                        },
                                        thumb: {
                                            type: 'string',
                                            format: 'uri',
                                            nullable: true,
                                            description: 'Thumbnail image URL for the extra',
                                            example:
                                                '/proxy?server=MyPlexServer&path=/library/metadata/12346/thumb',
                                        },
                                        key: {
                                            type: 'string',
                                            description:
                                                'Server-specific key/ID for the extra (used to construct streaming URLs)',
                                            example: '/library/metadata/12346',
                                        },
                                        duration: {
                                            type: 'integer',
                                            nullable: true,
                                            description: 'Duration in milliseconds',
                                            example: 155000,
                                        },
                                        year: {
                                            type: 'integer',
                                            nullable: true,
                                            example: 2017,
                                        },
                                        addedAt: {
                                            type: 'integer',
                                            nullable: true,
                                            description:
                                                'Timestamp when extra was added (Unix timestamp in seconds)',
                                            example: 1635724800,
                                        },
                                    },
                                },
                                example: [
                                    {
                                        type: 'clip',
                                        title: 'Official Trailer',
                                        thumb: '/proxy?server=MyPlexServer&path=/library/metadata/12346/thumb',
                                        key: '/library/metadata/12346',
                                        duration: 155000,
                                        year: 2017,
                                        addedAt: 1635724800,
                                    },
                                    {
                                        type: 'behindTheScenes',
                                        title: 'Making Of',
                                        thumb: '/proxy?server=MyPlexServer&path=/library/metadata/12347/thumb',
                                        key: '/library/metadata/12347',
                                        duration: 892000,
                                        year: 2017,
                                        addedAt: 1635724800,
                                    },
                                ],
                            },
                            trailer: {
                                type: 'object',
                                nullable: true,
                                description:
                                    'First trailer from the extras array for convenience. Only populated when includeExtras=true. Provides quick access to the main trailer without filtering the extras array.',
                                properties: {
                                    type: { type: 'string', example: 'clip' },
                                    title: { type: 'string', example: 'Official Trailer' },
                                    thumb: {
                                        type: 'string',
                                        format: 'uri',
                                        nullable: true,
                                        example:
                                            '/proxy?server=MyPlexServer&path=/library/metadata/12346/thumb',
                                    },
                                    key: {
                                        type: 'string',
                                        description:
                                            'Key to fetch full trailer metadata and construct streaming URL',
                                        example: '/library/metadata/12346',
                                    },
                                    duration: { type: 'integer', nullable: true, example: 155000 },
                                    year: { type: 'integer', nullable: true, example: 2017 },
                                    addedAt: {
                                        type: 'integer',
                                        nullable: true,
                                        example: 1635724800,
                                    },
                                },
                                example: {
                                    type: 'clip',
                                    title: 'Official Trailer',
                                    thumb: '/proxy?server=MyPlexServer&path=/library/metadata/12346/thumb',
                                    key: '/library/metadata/12346',
                                    duration: 155000,
                                    year: 2017,
                                    addedAt: 1635724800,
                                },
                            },
                            theme: {
                                type: 'string',
                                nullable: true,
                                description:
                                    'Raw theme music path from Plex (e.g., /library/metadata/12345/theme/1234567890). Only populated when includeExtras=true for Plex sources with theme music.',
                                example: '/library/metadata/12345/theme/1730000000',
                            },
                            themeUrl: {
                                type: 'string',
                                format: 'uri',
                                nullable: true,
                                description:
                                    'Proxied theme music URL for streaming (e.g., /proxy/plex?server=...&path=...). Only populated when includeExtras=true for Plex sources with theme music. Note: Direct streaming via /proxy/plex endpoint is planned but not yet implemented. For now, use /get-media?includeExtras=true and construct URLs manually.',
                                example:
                                    '/proxy?server=MyPlexServer&path=/library/metadata/12345/theme/1730000000',
                            },
                            _raw: {
                                type: 'object',
                                description:
                                    'Raw metadata from the media server (only included when debug mode is enabled in config). Useful for development and troubleshooting.',
                            },
                        },
                        example: {
                            key: 'plex-MyPlexServer-12345',
                            title: 'Blade Runner 2049',
                            backgroundUrl:
                                '/proxy?server=MyPlexServer&path=/library/metadata/12345/art/1234567890',
                            posterUrl:
                                '/proxy?server=MyPlexServer&path=/library/metadata/12345/thumb/1234567890',
                            thumbnailUrl: null,
                            clearLogoUrl:
                                '/proxy?server=MyPlexServer&path=/library/metadata/12345/clearlogo',
                            tagline: 'The key to the future is finally unearthed.',
                            rating: 8.0,
                            year: 2017,
                            imdbUrl: 'https://www.imdb.com/title/tt1856101/',
                            rottenTomatoes: {
                                score: 88,
                                icon: 'certified-fresh',
                                originalScore: 8.8,
                            },
                            extras: [
                                {
                                    type: 'clip',
                                    title: 'Official Trailer',
                                    thumb: '/proxy?server=MyPlexServer&path=/library/metadata/12346/thumb',
                                    key: '/library/metadata/12346',
                                    duration: 155000,
                                    year: 2017,
                                    addedAt: 1635724800,
                                },
                            ],
                            trailer: {
                                type: 'clip',
                                title: 'Official Trailer',
                                thumb: '/proxy?server=MyPlexServer&path=/library/metadata/12346/thumb',
                                key: '/library/metadata/12346',
                                duration: 155000,
                                year: 2017,
                                addedAt: 1635724800,
                            },
                            theme: '/library/metadata/12345/theme/1730000000',
                            themeUrl:
                                '/proxy?server=MyPlexServer&path=/library/metadata/12345/theme/1730000000',
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
                                description:
                                    'The hostname or IP address of the Plex server (e.g., 192.168.1.10 or plex.local)',
                                example: '192.168.1.10',
                            },
                            port: {
                                type: 'integer',
                                minimum: 1,
                                maximum: 65535,
                                description: 'The port of the Plex server (default: 32400)',
                                example: 32400,
                            },
                            token: {
                                type: 'string',
                                description:
                                    'The Plex X-Plex-Token. Find yours at: https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/',
                            },
                        },
                        example: {
                            hostname: '192.168.1.10',
                            port: 32400,
                            token: 'xxxxxxxxxxxxxxxxxxxx',
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
                        example: {
                            success: true,
                            libraries: [
                                { key: '1', name: 'Movies', type: 'movie' },
                                { key: '2', name: 'TV Shows', type: 'show' },
                                { key: '3', name: 'Music', type: 'artist' },
                            ],
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
                        example: {
                            config: {
                                clockWidget: true,
                                transitionIntervalSeconds: 30,
                                showClearLogo: true,
                                showPoster: true,
                            },
                            env: {
                                NODE_ENV: 'production',
                                PORT: '4000',
                            },
                            security: {
                                is2FAEnabled: false,
                            },
                        },
                    },
                    SaveConfigRequest: {
                        type: 'object',
                        properties: {
                            config: {
                                type: 'object',
                                description:
                                    'The complete config.json object to save. Must conform to config schema (see config.schema.json).',
                            },
                            env: {
                                type: 'object',
                                description:
                                    'Key-value pairs of environment variables to save to .env file. Only whitelisted variables are persisted.',
                            },
                        },
                        example: {
                            config: {
                                clockWidget: true,
                                transitionIntervalSeconds: 30,
                                showClearLogo: true,
                            },
                            env: {
                                PORT: '4000',
                            },
                        },
                    },
                    ChangePasswordRequest: {
                        type: 'object',
                        required: ['currentPassword', 'newPassword', 'confirmPassword'],
                        properties: {
                            currentPassword: {
                                type: 'string',
                                format: 'password',
                                description: 'Current admin password for verification',
                            },
                            newPassword: {
                                type: 'string',
                                format: 'password',
                                minLength: 8,
                                description:
                                    'New password (minimum 8 characters, should include mix of letters, numbers, and special characters)',
                            },
                            confirmPassword: {
                                type: 'string',
                                format: 'password',
                                description: 'Must match newPassword exactly',
                            },
                        },
                        example: {
                            currentPassword: 'oldPassword123',
                            newPassword: 'newSecurePass456!',
                            confirmPassword: 'newSecurePass456!',
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
                        example: {
                            qrCodeDataUrl:
                                'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
                        },
                    },
                    Verify2FARequest: {
                        type: 'object',
                        required: ['token'],
                        properties: {
                            token: {
                                type: 'string',
                                pattern: '^[0-9]{6}$',
                                minLength: 6,
                                maxLength: 6,
                                description:
                                    'The 6-digit TOTP code from the authenticator app (e.g., Google Authenticator, Authy)',
                            },
                        },
                        example: {
                            token: '123456',
                        },
                    },
                    Disable2FARequest: {
                        type: 'object',
                        required: ['password'],
                        properties: {
                            password: {
                                type: 'string',
                                format: 'password',
                                description:
                                    'The current admin password. Required for security verification before disabling 2FA.',
                            },
                        },
                        example: {
                            password: 'myAdminPassword123',
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
                        example: {
                            note: 'Debug information for current playlist',
                            playlist_item_count: 150,
                            playlist_items_raw: [
                                {
                                    title: 'Blade Runner 2049',
                                    year: 2017,
                                    rating: 8.0,
                                    source: 'plex',
                                },
                            ],
                        },
                    },
                    ApiKeyResponse: {
                        type: 'object',
                        properties: {
                            apiKey: {
                                type: 'string',
                                description:
                                    'The newly generated API key. Will only be shown once.',
                                example: 'pk_live_1234567890abcdefghijklmnop',
                            },
                            message: {
                                type: 'string',
                                example: 'API key generated successfully',
                            },
                        },
                        example: {
                            apiKey: 'pk_live_1234567890abcdefghijklmnop',
                            message:
                                'API key generated successfully. Store this securely - it will not be shown again.',
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
                        example: {
                            success: true,
                            message: 'Media playlist successfully refreshed. 150 items found.',
                            itemCount: 150,
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
                        example: {
                            timestamp: '2025-11-12T10:30:00.000Z',
                            level: 'INFO',
                            message: 'Media playlist refreshed successfully',
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
                        example: {
                            error: 'Resource not found',
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
                                description:
                                    'Name of the health check (e.g., configuration, filesystem, cache, plex_connectivity, jellyfin_connectivity, device_sla, cache_efficiency, performance, update_available)',
                                example: 'jellyfin_connectivity',
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
                        example: {
                            status: 'ok',
                            timestamp: '2025-11-12T10:30:00.000Z',
                            checks: [
                                {
                                    name: 'configuration',
                                    status: 'ok',
                                    message: 'Configuration valid',
                                },
                                {
                                    name: 'plex_connectivity',
                                    status: 'ok',
                                    message: 'Connected successfully',
                                },
                                {
                                    name: 'cache_efficiency',
                                    status: 'ok',
                                    message: 'Cache hit rate: 87%',
                                },
                            ],
                        },
                    },
                    ValidationResponse: {
                        type: 'object',
                        properties: {
                            valid: {
                                type: 'boolean',
                                description: 'Whether the data is valid',
                                example: true,
                            },
                            message: {
                                type: 'string',
                                description: 'Validation result message',
                                example: 'Validation passed',
                            },
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
                        example: {
                            valid: true,
                            message: 'Validation passed',
                            sanitized: {},
                            errors: [],
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
                        example: {
                            success: true,
                            message: 'Connection successful',
                            serverInfo: {
                                name: 'My Plex Server',
                                version: '1.40.0.7998',
                                platform: 'Linux',
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
                        example: {
                            hasApiKey: true,
                            keyId: 'key_abc123xyz789',
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
                        example: {
                            performance: {
                                avgResponseTime: 125,
                                p95ResponseTime: 450,
                                requestsPerMinute: 42,
                            },
                            endpoints: {
                                '/get-media': { count: 1520, avgTime: 98 },
                                '/api/devices/heartbeat': { count: 3840, avgTime: 15 },
                            },
                            system: {
                                memoryUsage: '256MB',
                                cpuUsage: '12%',
                                uptime: 3600,
                            },
                            cache: {
                                hitRate: 0.87,
                                size: '45MB',
                                entries: 150,
                            },
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
                        example: {
                            success: true,
                            genres: ['Action', 'Comedy', 'Drama', 'Horror', 'Sci-Fi', 'Thriller'],
                        },
                    },
                    LoginRequest: {
                        type: 'object',
                        required: ['username', 'password'],
                        properties: {
                            username: {
                                type: 'string',
                                minLength: 1,
                                maxLength: 100,
                                description: 'Username for authentication (typically "admin")',
                            },
                            password: {
                                type: 'string',
                                format: 'password',
                                minLength: 1,
                                description: 'Password for authentication',
                            },
                        },
                        example: {
                            username: 'admin',
                            password: 'mySecurePassword123',
                        },
                    },
                    LoginResponse: {
                        type: 'object',
                        properties: {
                            success: {
                                type: 'boolean',
                                description: 'Whether login was successful',
                                example: true,
                            },
                            requires2FA: {
                                type: 'boolean',
                                description: 'Whether 2FA verification is required',
                                example: false,
                            },
                            redirectTo: {
                                type: 'string',
                                description: 'URL to redirect to after login',
                                example: '/admin',
                            },
                            message: {
                                type: 'string',
                                description: 'Login result message',
                                example: 'Login successful',
                            },
                        },
                        example: {
                            success: true,
                            requires2FA: false,
                            redirectTo: '/admin',
                            message: 'Login successful',
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
                        example: {
                            sessions: [
                                {
                                    id: 'sess_abc123',
                                    userId: 'admin',
                                    createdAt: '2025-11-12T09:00:00.000Z',
                                    lastActivity: '2025-11-12T10:30:00.000Z',
                                    ipAddress: '192.168.1.100',
                                },
                            ],
                        },
                    },
                    TMDBConnectionRequest: {
                        type: 'object',
                        required: ['apiKey'],
                        properties: {
                            apiKey: {
                                type: 'string',
                                minLength: 32,
                                maxLength: 64,
                                description:
                                    'The TMDB API key. Get yours free at: https://www.themoviedb.org/settings/api',
                            },
                        },
                        example: {
                            apiKey: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6',
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
                        example: {
                            success: true,
                            genres: [
                                'Action',
                                'Adventure',
                                'Animation',
                                'Comedy',
                                'Crime',
                                'Documentary',
                                'Drama',
                                'Fantasy',
                                'Horror',
                                'Science Fiction',
                            ],
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
                        example: {
                            success: true,
                            genres: ['Action', 'Comedy', 'Drama', 'Horror', 'Romance', 'Sci-Fi'],
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
                        example: {
                            success: true,
                            release: {
                                id: 123456789,
                                tag_name: 'v2.8.1',
                                name: 'Release 2.8.1',
                                body: '## Bug Fixes\n- Fixed MQTT broker display issue\n- Improved error handling',
                                published_at: '2025-10-25T10:00:00Z',
                                prerelease: false,
                            },
                        },
                    },
                    UpdateCheckResponse: {
                        type: 'object',
                        properties: {
                            success: { type: 'boolean', example: true },
                            hasUpdate: { type: 'boolean', example: true },
                            currentVersion: { type: 'string', example: '2.8.0' },
                            latestVersion: { type: 'string', example: '2.8.1' },
                            releaseInfo: { $ref: '#/components/schemas/GitHubRelease' },
                        },
                        example: {
                            success: true,
                            hasUpdate: true,
                            currentVersion: '2.8.0',
                            latestVersion: '2.8.1',
                            releaseInfo: {
                                id: 123456,
                                tag_name: 'v2.8.1',
                                name: 'Release 2.8.1',
                                body: '## Bug Fixes\n- Fixed MQTT broker display issue',
                                published_at: '2025-10-25T10:00:00Z',
                                prerelease: false,
                            },
                        },
                    },
                },
            },
        },
        apis: ['./server.js', './routes/**/*.js', './__tests__/routes/test-endpoints.js'], // Include routes modules and test endpoints
    };

    const spec = swaggerJSDoc(options);

    // Internal endpoint filtering (x-internal) can be disabled via EXPOSE_INTERNAL_ENDPOINTS=true
    try {
        const exposeInternal = process.env.EXPOSE_INTERNAL_ENDPOINTS === 'true';
        if (!exposeInternal && spec && spec.paths) {
            for (const [p, methods] of Object.entries(spec.paths)) {
                for (const m of Object.keys(methods)) {
                    if (methods[m] && methods[m]['x-internal'] === true) delete methods[m];
                }
                if (Object.keys(methods).length === 0) delete spec.paths[p];
            }
        }
        // Clean up Testing tag only if no remaining ops use it
        if (spec.tags && spec.paths) {
            const hasTesting = Object.values(spec.paths).some(methods =>
                Object.values(methods || {}).some(
                    op => Array.isArray(op.tags) && op.tags.includes('Testing')
                )
            );
            if (!hasTesting) spec.tags = spec.tags.filter(t => t.name !== 'Testing');
        }
    } catch (_) {
        // Non-fatal if sanitization fails
    }

    // Post-process: Ensure all endpoints have 200 responses
    // This fixes endpoints where JSDoc is incomplete
    if (spec && spec.paths) {
        for (const [pathKey, methods] of Object.entries(spec.paths)) {
            for (const [method, operation] of Object.entries(methods)) {
                if (typeof operation !== 'object' || !operation) continue;

                // Skip parameter definitions
                if (method === 'parameters') continue;

                // Ensure responses object exists
                if (!operation.responses) {
                    operation.responses = {};
                }

                // Add 200 response if missing
                if (!operation.responses['200']) {
                    const isHtmlEndpoint =
                        pathKey.includes('.html') ||
                        pathKey === '/' ||
                        pathKey.startsWith('/admin') ||
                        pathKey.startsWith('/cinema') ||
                        pathKey.startsWith('/wallart') ||
                        pathKey.startsWith('/screensaver') ||
                        pathKey.startsWith('/preview');

                    const isJsonEndpoint =
                        pathKey.startsWith('/api/') ||
                        pathKey === '/get-media' ||
                        pathKey === '/get-config';

                    if (isHtmlEndpoint) {
                        operation.responses['200'] = {
                            description: 'Success',
                            content: {
                                'text/html': {
                                    schema: { type: 'string' },
                                    example: '<!DOCTYPE html>...',
                                },
                            },
                        };
                    } else if (isJsonEndpoint) {
                        operation.responses['200'] = {
                            description: 'Success',
                            content: {
                                'application/json': {
                                    schema: { type: 'object' },
                                    example: {
                                        ok: true,
                                        message: 'Operation completed successfully',
                                    },
                                },
                            },
                        };
                    } else {
                        // Generic 200 for other endpoints
                        operation.responses['200'] = {
                            description: 'Success',
                            content: {
                                'application/octet-stream': {
                                    schema: { type: 'string', format: 'binary' },
                                },
                            },
                        };
                    }
                }

                // Ensure 200 response has examples
                if (operation.responses['200'] && operation.responses['200'].content) {
                    for (const [contentType, mediaType] of Object.entries(
                        operation.responses['200'].content
                    )) {
                        if (
                            !mediaType.example &&
                            !mediaType.examples &&
                            !(mediaType.schema && mediaType.schema.example)
                        ) {
                            // Add basic example based on content type
                            if (contentType === 'application/json') {
                                mediaType.example = {
                                    ok: true,
                                    message: 'Operation completed successfully',
                                };
                            } else if (contentType === 'text/html') {
                                mediaType.example = '<!DOCTYPE html>...';
                            } else {
                                mediaType.example = 'Binary data';
                            }
                        }
                    }
                }

                // Add standard error responses for API endpoints (if missing)
                const isApiEndpoint =
                    pathKey.startsWith('/api/') ||
                    pathKey === '/get-media' ||
                    pathKey === '/get-config' ||
                    pathKey === '/get-media-by-key';

                if (isApiEndpoint) {
                    // Add 400 Bad Request if missing (for endpoints with parameters)
                    const hasParams =
                        operation.parameters?.length > 0 ||
                        operation.requestBody ||
                        pathKey.includes('{') ||
                        pathKey.includes(':');

                    if (hasParams && !operation.responses['400']) {
                        operation.responses['400'] = {
                            description: 'Invalid request parameters',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/StandardErrorResponse' },
                                    example: {
                                        error: 'Invalid request parameters',
                                        statusCode: 400,
                                    },
                                },
                            },
                        };
                    }

                    // Add 401 Unauthorized for protected endpoints (if missing)
                    const isProtected =
                        operation.security &&
                        operation.security.length > 0 &&
                        operation.security.some(s => Object.keys(s).length > 0);

                    if (isProtected && !operation.responses['401']) {
                        operation.responses['401'] = {
                            description: 'Unauthorized - Authentication required',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/StandardErrorResponse' },
                                    example: {
                                        error: 'Unauthorized',
                                        message: 'Authentication required to access this endpoint',
                                        statusCode: 401,
                                    },
                                },
                            },
                        };
                    }

                    // Add 404 Not Found for endpoints with path parameters (if missing)
                    const hasPathParams = pathKey.includes('{') || pathKey.includes(':');
                    if (hasPathParams && !operation.responses['404']) {
                        operation.responses['404'] = {
                            description: 'Resource not found',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/StandardErrorResponse' },
                                    example: {
                                        error: 'Not found',
                                        message: 'The requested resource does not exist',
                                        statusCode: 404,
                                    },
                                },
                            },
                        };
                    }

                    // Add 500 Internal Server Error if missing
                    if (!operation.responses['500']) {
                        operation.responses['500'] = {
                            description: 'Internal server error',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/StandardErrorResponse' },
                                    example: {
                                        error: 'Internal server error',
                                        statusCode: 500,
                                    },
                                },
                            },
                        };
                    }
                }

                // Add security: [] for public endpoints (no auth required)
                const publicPaths = [
                    '/api/v1/config',
                    '/api/v1/media',
                    '/',
                    '/index.html',
                    '/get-media',
                    '/get-config',
                    '/image',
                    '/health',
                    '/api/health',
                    '/screensaver',
                    '/cinema',
                    '/wallart',
                    '/preview',
                    '/api-docs',
                    '/api-docs/swagger.json',
                    '/api/config',
                    '/api/version',
                    '/api/github/latest',
                    '/local-posterpack',
                    '/local-media',
                    '/2fa-verify.html',
                    '/setup.html',
                    '/login.html',
                ];

                const isPublic = publicPaths.some(p => pathKey === p || pathKey.startsWith(p));

                if (isPublic && !operation.security) {
                    operation.security = []; // Explicitly mark as public (no security)
                }
            }
        }
    }

    return spec;
}

// Export both the generator function and the current spec (for existing consumers)
const swaggerSpec = generateSwaggerSpec();
module.exports = swaggerSpec;
module.exports.generate = generateSwaggerSpec;
