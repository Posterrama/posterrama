# Development Guide

Technical documentation for Posterrama development, dependencies, and advanced configuration.

## 📋 Table of Contents

- [Architecture Overview](#architecture-overview)
- [Dependency Management](#dependency-management)
- [API Documentation](#api-documentation)
- [Database Schema](#database-schema)
- [Performance Optimization](#performance-optimization)
- [Troubleshooting](#troubleshooting)

## 🏗️ Architecture Overview

### Core Components

```
posterrama/
├── server.js           # Main application server
├── sources/           # Media source integrations
│   ├── plex.js       # Plex Media Server
│   ├── jellyfin.js   # Jellyfin integration
│   ├── tmdb.js       # The Movie Database
│   └── tvdb.js       # TheTVDB
├── public/           # Frontend assets
├── middleware/       # Express middleware
└── utils/           # Shared utilities
```

### Data Flow

1. **Media Sources** → Fetch content from Plex/Jellyfin/TMDB/TVDB
2. **Processing** → Normalize metadata, cache images
3. **API** → Serve aggregated data via REST endpoints
4. **Frontend** → Display content with smooth transitions

## 📦 Dependency Management

### Production Dependencies

| Package         | Purpose            | Notes        |
| --------------- | ------------------ | ------------ |
| `express`       | Web framework      | Core server  |
| `@jellyfin/sdk` | Jellyfin API       | Media source |
| `plex-api`      | Plex integration   | Media source |
| `node-cache`    | In-memory caching  | Performance  |
| `sharp`         | Image processing   | Optimization |
| `speakeasy`     | 2FA authentication | Security     |

### Development Dependencies

| Package     | Purpose            | Notes                  |
| ----------- | ------------------ | ---------------------- |
| `jest`      | Testing framework  | Unit/integration tests |
| `eslint`    | Code linting       | Code quality           |
| `nodemon`   | Development server | Auto-restart           |
| `supertest` | HTTP testing       | API tests              |

### Dependency Updates

#### Safe Update Strategy

1. **Check compatibility** before updating
2. **Test thoroughly** with updated versions
3. **Update gradually** (not all at once)
4. **Monitor for issues** after deployment

#### Update Commands

```bash
# Check outdated packages
npm outdated

# Update within semver range
npm update

# Update specific package
npm install package@latest

# Update dev dependencies
npm update --dev
```

#### Security Updates

```bash
# Check for vulnerabilities
npm audit

# Fix automatically
npm audit fix

# Manual review for breaking changes
npm audit fix --force
```

## 🔧 API Documentation

### Core Endpoints

#### Media Endpoints

```
GET /api/media           # Get all media items
GET /api/media/random    # Get random media item
GET /api/media/movies    # Get movies only
GET /api/media/shows     # Get TV shows only
```

#### Configuration

```
GET /api/config          # Get current configuration
POST /api/config         # Update configuration
GET /api/config/test     # Test media server connections
```

#### System

```
GET /api/health          # Health check
GET /api/metrics         # Performance metrics
GET /api/cache/clear     # Clear cache
```

### Response Formats

#### Media Item

```json
{
    "id": "unique-identifier",
    "title": "Movie Title",
    "type": "movie|show",
    "year": 2024,
    "poster": "https://image-url",
    "backdrop": "https://backdrop-url",
    "rating": 8.5,
    "source": "plex|jellyfin|tmdb|tvdb"
}
```

#### Error Response

```json
{
    "error": "Error message",
    "code": "ERROR_CODE",
    "details": {}
}
```

### Live command ACKs (optional)

Device command endpoints support optional wait-for-ack semantics over WebSocket:

- Single device: `POST /api/devices/:id/command?wait=true`
    - Body: `{ "type": "core.mgmt.reload", "payload": { /* optional */ } }`
    - Responses:
        - `{ queued: false, live: true, ack: { status: "ok" } }` when device ACKs within ~3s
        - `202 Accepted` with `{ queued: false, live: true, ack: { status: "timeout" } }` if ACK not received in time
        - `{ queued: true, live: false, command: { ... } }` if device offline (fallback queue)

- Group: `POST /api/groups/:id/command?wait=true`
    - Returns per-device `results` with statuses: `ok`, `timeout`, `queued`, or `error`.

Notes:

- Without `wait=true`, behavior remains unchanged (fire-and-forget live send with offline queue fallback).
- Devices ACK immediately for critical operations (reload/reset/clear-cache) before the action, to avoid losing the ACK on reload.

### Device Management API quick reference

Admin endpoints require an authenticated session or a Bearer token; device endpoints are unauthenticated but require deviceId/deviceSecret when applicable. Replace placeholders as needed.

- Device register: `POST /api/devices/register`
- Device heartbeat/poll: `POST /api/devices/heartbeat`
- List devices: `GET /api/devices`
- Get/patch/delete device: `GET|PATCH|DELETE /api/devices/{id}`
- Generate pairing code: `POST /api/devices/{id}/pairing-code`
- Device claim (pair): `POST /api/devices/pair`
- Send device command: `POST /api/devices/{id}/command[?wait=true]`
- Groups CRUD: `GET|POST /api/groups`, `PATCH|DELETE /api/groups/{id}`
- Send group command: `POST /api/groups/{id}/command[?wait=true]`

Examples

```bash
# Device: register
curl -sS -X POST http://localhost:4000/api/devices/register \
    -H 'Content-Type: application/json' \
    -d '{"installId":"iid-123","hardwareId":"hw-123","name":"Kiosk"}'

# Device: heartbeat + poll
curl -sS -X POST http://localhost:4000/api/devices/heartbeat \
    -H 'Content-Type: application/json' \
    -d '{"deviceId":"<id>","deviceSecret":"<secret>","userAgent":"curl","screen":{"w":1920,"h":1080,"dpr":1}}'

# Admin: list devices
curl -sS http://localhost:4000/api/devices \
    -H 'Authorization: Bearer <TOKEN>'

# Admin: send command and wait for ACK (returns per-device for groups)
curl -sS -X POST 'http://localhost:4000/api/devices/<ID>/command?wait=true' \
    -H 'Authorization: Bearer <TOKEN>' -H 'Content-Type: application/json' \
    -d '{"type":"core.mgmt.reload"}'

# Admin: group broadcast with wait=true
curl -sS -X POST 'http://localhost:4000/api/groups/<GROUP>/command?wait=true' \
    -H 'Authorization: Bearer <TOKEN>' -H 'Content-Type: application/json' \
    -d '{"type":"core.mgmt.clear-cache"}'

# Pairing: admin creates code, device claims
curl -sS -X POST http://localhost:4000/api/devices/<ID>/pairing-code \
    -H 'Authorization: Bearer <TOKEN>' -H 'Content-Type: application/json' \
    -d '{"ttlMs":600000}'
curl -sS -X POST http://localhost:4000/api/devices/pair \
    -H 'Content-Type: application/json' \
    -d '{"code":"123456","token":"<from previous>","name":"Lobby"}'
```

Notes

- With `wait=true`, single-device responses include `ack.status` or `queued`; group responses include `results` with `ok|timeout|queued|error` per device.
- Devices ACK immediately for reload/clear-cache to avoid losing ACK on reload.

## 🗄️ Configuration Schema

### Media Servers

```json
{
    "mediaServers": [
        {
            "name": "My Plex Server",
            "type": "plex|jellyfin",
            "enabled": true,
            "hostnameEnvVar": "PLEX_HOSTNAME",
            "portEnvVar": "PLEX_PORT",
            "tokenEnvVar": "PLEX_TOKEN",
            "movieLibraryNames": ["Movies"],
            "showLibraryNames": ["TV Shows"]
        }
    ]
}
```

### Display Settings

```json
{
    "wallartMode": {
        "enabled": false,
        "density": "medium|low|high|ludicrous",
        "refreshRate": 5,
        "animationType": "fade|slideLeft|zoom|..."
    },
    "cinemaMode": false,
    "uiScaling": {
        "content": 100,
        "clearlogo": 100,
        "clock": 100,
        "global": 100
    }
}
```

## ⚡ Performance Optimization

### Caching Strategy

- **Image Cache**: 24h TTL for poster/backdrop images
- **Metadata Cache**: 1h TTL for API responses
- **Config Cache**: 5min TTL for configuration

### Image Optimization

```javascript
// Sharp configuration for image processing
const optimizedImage = await sharp(inputBuffer)
    .resize(400, 600, { fit: 'cover' })
    .jpeg({ quality: 85 })
    .toBuffer();
```

### Memory Management

- Use streams for large image processing
- Clear unused cache entries regularly
- Monitor memory usage in production

### Database Queries

- Limit result sets appropriately
- Use efficient query patterns
- Cache expensive operations

## 🐛 Troubleshooting

### Common Issues

#### "Cannot connect to Plex server"

1. Check hostname/port configuration
2. Verify Plex token is valid
3. Check network connectivity
4. Review firewall settings

#### "High memory usage"

1. Check image cache size
2. Monitor for memory leaks
3. Restart application if needed
4. Review cache TTL settings

#### "Slow loading times"

1. Check image optimization settings
2. Verify cache configuration
3. Monitor network latency
4. Review media source response times

### Debugging

```bash
# Enable debug logging
DEBUG=true npm start

# Check logs
tail -f logs/app.log

# Monitor memory usage
node --inspect server.js
```

### Performance Monitoring

```bash
# Get performance metrics
curl http://localhost:4000/api/metrics

# Check health status
curl http://localhost:4000/api/health
```

## 🔒 Security Considerations

### Environment Variables

- Never commit sensitive values
- Use strong authentication tokens
- Rotate credentials regularly

### Input Validation

- Validate all user inputs
- Sanitize file paths
- Check media server responses

### Rate Limiting

- Implement API rate limits
- Protect against abuse
- Monitor for suspicious activity

## 📚 Additional Resources

- [Express.js Documentation](https://expressjs.com/)
- [Jest Testing Framework](https://jestjs.io/)
- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)
- [ESLint Configuration](https://eslint.org/docs/latest/)

---

For more information, see the [Contributing Guide](CONTRIBUTING.md) or open a GitHub Discussion.
