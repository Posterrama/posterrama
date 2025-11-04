/**
 * OpenAPI/Swagger specification for Posterrama API
 * This specification is generated dynamically from JSDoc comments in route definitions
 * in the source code. This specification is then used by ReDoc to render
 * interactive API documentation at /api-docs.
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
                description: `# Posterrama API Documentation

**Posterrama** transforms any screen into a dynamic movie poster gallery by aggregating media from multiple sources including Plex, Jellyfin, and TMDB.

## Overview

This API provides comprehensive access to:
- **Media Management**: Retrieve and display movie/TV show posters with metadata
- **Device Control**: Manage display devices, groups, and real-time playback
- **Configuration**: Complete system and per-device settings management
- **Admin Panel**: Full administrative control and monitoring

## Key Features

### Multi-Source Aggregation
Posterrama seamlessly combines content from:
- **Plex Media Server**: Direct integration with your local media library
- **Jellyfin**: Open-source media server support
- **TMDB**: The Movie Database for trending content
- **Local Posterpacks**: Offline ZIP-based media packages

### Display Modes
Three distinct viewing experiences:
- **Screensaver**: Rotating poster display with customizable transitions
- **Cinema**: Coming attractions style with trailers and theme music
- **Wallart**: Gallery-style continuous display

### Real-time Control
- WebSocket-based device management
- Live settings updates without page reload
- Group broadcasting for multi-device setups
- Remote command execution (pause, play, reload, etc.)

## Authentication

The API uses session-based authentication with cookies for admin endpoints. Public endpoints (like \`/get-media\`) are accessible without authentication.

**Security Note**: Always use HTTPS in production to protect session cookies.

## Rate Limiting

Some endpoints have rate limiting to prevent abuse:
- Media endpoints: Cached responses with configurable TTL
- Admin operations: Standard rate limits apply
- WebSocket connections: Maximum 1 active connection per device

## Getting Started

1. Access the admin panel at \`/admin\` to configure your media sources
2. Use \`/get-media\` to retrieve the aggregated playlist
3. Implement the display frontend using \`/screensaver\`, \`/cinema\`, or \`/wallart\` modes
4. Register devices via \`/api/devices/register\` for remote control

For more information, visit the [GitHub repository](https://github.com/Posterrama/posterrama).`,
                contact: {
                    name: 'Posterrama Project',
                    url: 'https://github.com/Posterrama/posterrama',
                    email: 'support@posterrama.app',
                },
                license: {
                    name: 'GPL-3.0-or-later',
                    url: 'https://www.gnu.org/licenses/gpl-3.0.html',
                },
            },
            tags: [
                // === 1. CORE API (meest gebruikt) ===
                {
                    name: 'Public API',
                    description: `Public endpoints accessible without authentication. These are the core endpoints used by display devices to retrieve media content, images, and configuration.
                    
**Key Endpoints:**
- \`/get-media\`: Primary media playlist endpoint
- \`/proxy\`: Image proxy for secure media delivery
- \`/get-config\`: Public configuration retrieval`,
                },
                {
                    name: 'Frontend',
                    description: `Frontend asset serving and template rendering. Serves the HTML/CSS/JS for the display modes and admin interface.
                    
**Available Pages:**
- \`/screensaver\`: Rotating poster display
- \`/cinema\`: Movie theater experience
- \`/wallart\`: Gallery-style display
- \`/admin\`: Administrative control panel
- \`/admin-analytics\`: Analytics dashboard

**Static Assets:**
- Versioned CSS/JS with cache busting
- Favicon and branding assets
- Font files and icons`,
                },

                // === 2. AUTHENTICATION & SECURITY ===
                {
                    name: 'Authentication',
                    description: `Authentication and authorization system. Posterrama uses session-based authentication with optional 2FA support.
                    
**Security Features:**
- Session management with secure cookies
- Password hashing (bcrypt)
- Two-factor authentication (TOTP)
- API key support for programmatic access
- Rate limiting on auth endpoints

**Session Lifecycle:**
- Login creates session cookie (connect.sid)
- Session persists across requests
- Logout invalidates session`,
                },
                {
                    name: 'Security',
                    description: `Security monitoring and violation reporting. Tracks authentication failures, rate limit violations, and suspicious activity.
                    
**Security Features:**
- Failed login tracking
- Rate limit enforcement
- Session hijacking protection
- CSRF protection
- Security headers (CSP, HSTS)
- IP-based blocking

**Monitoring:**
- Real-time security event log
- Violation statistics
- IP reputation tracking
- Alert notifications for security events`,
                },

                // === 3. ADMIN & CONFIGURATION ===
                {
                    name: 'Admin',
                    description: `Administrative endpoints for system configuration and management. These endpoints require an active admin session.
                    
**Capabilities:**
- Complete configuration management
- System monitoring and performance metrics
- User authentication and session management
- Backup and restore operations
- Source connection testing

**Authentication Required**: Session-based (cookie: connect.sid)`,
                },
                {
                    name: 'Configuration',
                    description: `Application configuration management. Configuration is stored in \`config.json\` with automatic validation and hot-reloading support.
                    
**Configuration Sections:**
- Media sources (Plex, Jellyfin, TMDB, Local)
- Display mode settings (Screensaver, Cinema, Wallart)
- Server settings (port, cache, logging)
- Device management
- Security settings

**Best Practices:**
- Always validate before saving
- Create backups before major changes
- Test source connections after updates`,
                },
                {
                    name: 'Validation',
                    description: `Configuration and data validation endpoints. These endpoints validate configuration changes before applying them, preventing invalid configurations.
                    
**Validation Types:**
- Server connectivity (Plex, Jellyfin)
- API key validity
- Configuration schema compliance
- Port availability
- File path accessibility`,
                },

                // === 4. DEVICE MANAGEMENT ===
                // === 4. DEVICE MANAGEMENT ===
                {
                    name: 'Devices',
                    description: `Device management system for controlling display clients. Posterrama supports registering unlimited devices and organizing them into groups.
                    
**Features:**
- Device registration with pairing codes
- Real-time status monitoring
- Per-device settings overrides
- Heartbeat tracking
- WebSocket command channel

**Device Lifecycle:**
1. Register via \`/api/devices/register\`
2. Pair with code via \`/api/devices/pair\`
3. Send heartbeats via \`/api/devices/heartbeat\`
4. Receive commands via WebSocket at \`/ws/devices\``,
                },
                {
                    name: 'Groups',
                    description: `Organize devices into logical groups for coordinated control. Groups enable broadcasting commands to multiple devices simultaneously.
                    
**Use Cases:**
- Floor/room organization
- Synchronized displays
- Bulk configuration updates
- Targeted content delivery

**Operations:**
- Create and manage groups
- Assign devices to groups
- Broadcast commands to all group members`,
                },

                // === 5. MEDIA SOURCES ===
                {
                    name: 'Local Directory',
                    description: `Local media source management for posterpack archives and directory-based media. Supports offline media delivery and custom collections.
                    
**Features:**
- Posterpack generation from Plex/Jellyfin
- ZIP archive management
- Directory browsing
- File upload/download
- Metadata management
- Asset extraction (posters, backgrounds, trailers, themes)

**Posterpack Format:**
A posterpack is a self-contained ZIP archive containing:
- \`metadata.json\`: Complete media information
- \`poster.jpg\`: Movie/show poster
- \`background.jpg\`: Backdrop image
- \`thumbnail.jpg\`: Small preview image
- \`trailer.mp4\`: Optional trailer video
- \`theme.mp3\`: Optional theme music
- \`clearlogo.png\`: Optional logo overlay
- \`people/\`: Cast/crew photos

**Use Cases:**
- Offline display setups
- Custom media collections
- Pre-packaged content distribution
- Backup media libraries`,
                },

                // === 6. SYSTEM MONITORING ===
                {
                    name: 'Cache',
                    description: `Multi-tier caching system for optimal performance. Posterrama uses memory and disk caching with intelligent invalidation.
                    
**Cache Types:**
- **Memory Cache**: Fast in-memory storage for API responses
- **Disk Cache**: Persistent image cache
- **HTTP Cache**: ETags and conditional requests
- **Browser Cache**: Client-side caching with versioning

**Operations:**
- View cache statistics
- Clear specific cache entries
- Invalidate on configuration changes
- Configure TTL per endpoint`,
                },
                {
                    name: 'Metrics',
                    description: `Performance monitoring and metrics collection. Real-time system health, source performance, and cache statistics.
                    
**Metrics Categories:**
- System resources (CPU, memory, uptime)
- Source performance (response times, error rates)
- Cache efficiency (hit rate, size, TTL)
- Request statistics (throughput, latency)
- Device activity (connections, commands)

**Use Cases:**
- Performance optimization
- Troubleshooting slow responses
- Capacity planning
- Source reliability monitoring`,
                },

                // === 7. UPDATES & INTEGRATIONS ===
                {
                    name: 'Auto-Update',
                    description: `Automatic application update system powered by PM2 ecosystem. Safely updates Posterrama to the latest version with rollback support.
                    
**Update Process:**
1. Backup current configuration
2. Pull latest code from GitHub
3. Install npm dependencies
4. Run database migrations (if any)
5. Restart application gracefully
6. Verify health post-update

**Safety Features:**
- Automatic configuration backups
- Health check verification
- Rollback on failure
- Update status tracking
- Manual control override

**Requirements:**
- PM2 process manager
- Git repository access
- Write permissions to install directory`,
                },
                {
                    name: 'GitHub Integration',
                    description: `Integration with GitHub API for release information and automatic updates.
                    
**Features:**
- Check for latest releases
- Download release assets
- Version comparison
- Changelog retrieval
- Release notes display

**Update Process:**
1. Check \`/api/admin/github/latest-release\`
2. Compare with current version
3. Notify admin of available updates
4. Optional: Auto-update via updater service`,
                },

                // === 8. UTILITIES & MISC ===
                {
                    name: 'Documentation',
                    description: `API documentation and specification endpoints. Provides access to this interactive documentation and the raw OpenAPI specification.
                    
**Endpoints:**
- \`/api-docs\`: Interactive ReDoc documentation (this page)
- \`/api-docs/swagger.json\`: Raw OpenAPI 3.0 specification

**OpenAPI Spec:**
The OpenAPI specification is dynamically generated from JSDoc comments in the source code, ensuring documentation stays synchronized with implementation.`,
                },
                {
                    name: 'Testing',
                    description: `Development and testing utilities. These endpoints help developers test functionality and troubleshoot issues.
                    
**Available Tests:**
- Notification system testing
- Source connection verification
- Cache behavior inspection
- WebSocket connectivity
- Performance benchmarking`,
                },
                {
                    name: 'Site Server',
                    description: `Public-facing site server for marketing and information pages. Serves static content about Posterrama.
                    
**Content:**
- Project information
- Installation guides
- Feature showcase
- Support resources
- Community links

**Note:** These endpoints are separate from the application API and do not require authentication.`,
                },
            ],
            'x-tagGroups': [
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
            servers: [
                {
                    url: '/',
                    description: 'Current server',
                },
            ],
            components: {
                securitySchemes: {
                    isAuthenticated: {
                        type: 'apiKey',
                        in: 'cookie',
                        name: 'connect.sid',
                        description: 'Session-based authentication (alias for sessionAuth)',
                    },
                    sessionAuth: {
                        type: 'apiKey',
                        in: 'cookie',
                        name: 'connect.sid',
                        description: 'Session-based authentication using cookies',
                    },
                    bearerAuth: {
                        type: 'http',
                        scheme: 'bearer',
                        bearerFormat: 'JWT',
                        description:
                            'Bearer token authentication. The application accepts API keys as Bearer tokens.',
                    },
                    BearerAuth: {
                        type: 'http',
                        scheme: 'bearer',
                        bearerFormat: 'JWT',
                        description: 'Bearer token authentication (alias for bearerAuth).',
                    },
                    SessionAuth: {
                        type: 'apiKey',
                        in: 'cookie',
                        name: 'connect.sid',
                        description: 'Session-based authentication (alias for sessionAuth)',
                    },
                    ApiKeyAuth: {
                        type: 'http',
                        scheme: 'bearer',
                        bearerFormat: 'API-Key',
                        description: 'API Key authentication using Bearer scheme',
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
                    },
                    BackupCleanupResponse: {
                        type: 'object',
                        properties: {
                            ok: { type: 'boolean' },
                            removed: { type: 'integer' },
                            retained: { type: 'integer' },
                        },
                    },
                    BackupRestoreResponse: {
                        type: 'object',
                        properties: {
                            ok: { type: 'boolean' },
                            restored: { type: 'boolean' },
                            backup: { $ref: '#/components/schemas/BackupRecord' },
                        },
                    },
                    BackupDeleteResponse: {
                        type: 'object',
                        properties: {
                            ok: { type: 'boolean' },
                            deleted: { type: 'boolean' },
                            id: { type: 'string' },
                        },
                    },
                    BackupSchedule: {
                        type: 'object',
                        properties: {
                            enabled: { type: 'boolean' },
                            cron: {
                                type: 'string',
                                description: 'Cron expression for automated backups',
                            },
                            retain: { type: 'integer', description: 'How many backups to retain' },
                        },
                    },
                    BackupScheduleResponse: {
                        type: 'object',
                        properties: {
                            ok: { type: 'boolean' },
                            schedule: { $ref: '#/components/schemas/BackupSchedule' },
                        },
                    },
                    NotificationTestRequest: {
                        type: 'object',
                        properties: {
                            level: {
                                type: 'string',
                                enum: ['info', 'warn', 'error'],
                                default: 'warn',
                            },
                            message: { type: 'string' },
                        },
                    },
                    NotificationTestResponse: {
                        type: 'object',
                        properties: {
                            ok: { type: 'boolean' },
                            level: { type: 'string' },
                            message: { type: 'string' },
                        },
                    },
                    StandardErrorResponse: {
                        type: 'object',
                        properties: {
                            error: {
                                type: 'string',
                                description: 'Error message',
                                example: 'Invalid request',
                            },
                            code: {
                                type: 'string',
                                description: 'Optional machine-readable code',
                                example: 'VALIDATION_ERROR',
                            },
                        },
                        example: {
                            error: 'Invalid request',
                            code: 'VALIDATION_ERROR',
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

    return spec;
}

// Export both the generator function and the current spec (for existing consumers)
const swaggerSpec = generateSwaggerSpec();
module.exports = swaggerSpec;
module.exports.generate = generateSwaggerSpec;
