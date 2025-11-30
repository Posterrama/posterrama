# Posterrama Architecture Diagrams

**Version**: 2.9.8
**Last Updated**: 2025-11-28
**Server Size**: 7,367 lines (Refactored from ~20k lines)

---

## Overview

This document provides visual representations of Posterrama's modular architecture, request flows, and system interactions. All diagrams use Mermaid format for inline rendering in GitHub and VS Code.

---

## ️ High-Level System Architecture

```mermaid
graph TB
 subgraph "Client Layer"
 A1[Browser/Admin UI]
 A2[Display Devices]
 A3[External APIs]
 end

 subgraph "Application Layer - server.js (7,367 lines)"
 B1[Express Server]
 B2[WebSocket Hub]
 B3[Session Manager]
 end

 subgraph "Route Layer (21 modules, ~13k lines)"
 C1[Admin Routes]
 C2[Device Routes]
 C3[Media Routes]
 C4[Auth Routes]
 C5[Public API Routes]
 end

 subgraph "Business Logic Layer (14 modules, 4,479 lines)"
 D1[Media Aggregator]
 D2[Plex Helpers]
 D3[Jellyfin Helpers]
 D4[Config Helpers]
 D5[Playlist Cache]
 D6[WebSocket Handlers]
 end

 subgraph "Middleware Layer"
 E1[Authentication]
 E2[Rate Limiting]
 E3[Cache]
 E4[Error Handler]
 E5[Metrics]
 E6[Validation]
 end

 subgraph "Data Layer"
 F1[Sources: Plex]
 F2[Sources: Jellyfin]
 F3[Sources: TMDB]
 F4[Sources: Local]
 F5[Utils: Cache]
 F6[Utils: Logger]
 end

 subgraph "External Systems"
 G1[Plex Media Server]
 G2[Jellyfin Server]
 G3[TMDB API]
 G4[Local File System]
 end

 A1 --> B1
 A2 --> B2
 A3 --> B1

 B1 --> E1
 B2 --> D6
 E1 --> E2
 E2 --> E3
 E3 --> E6
 E6 --> E4
 E4 --> E5

 E5 --> C1
 E5 --> C2
 E5 --> C3
 E5 --> C4
 E5 --> C5

 C1 --> D4
 C2 --> D6
 C3 --> D1
 C4 --> B3

 D1 --> D2
 D1 --> D3
 D1 --> D5
 D2 --> F1
 D3 --> F2
 D5 --> F5

 F1 --> G1
 F2 --> G2
 F1 --> F6
 F2 --> F6
 F3 --> G3
 F4 --> G4

 style B1 fill:#4CAF50,stroke:#2E7D32,stroke-width:3px
 style B2 fill:#4CAF50,stroke:#2E7D32,stroke-width:3px
 style C1 fill:#2196F3,stroke:#1565C0,stroke-width:2px
 style C2 fill:#2196F3,stroke:#1565C0,stroke-width:2px
 style C3 fill:#2196F3,stroke:#1565C0,stroke-width:2px
 style D1 fill:#FF9800,stroke:#E65100,stroke-width:2px
 style D2 fill:#FF9800,stroke:#E65100,stroke-width:2px
 style D3 fill:#FF9800,stroke:#E65100,stroke-width:2px
```

---

## Request Flow: Media Aggregation

Shows the complete flow from client request to media delivery:

```mermaid
sequenceDiagram
 participant Client
 participant Server as server.js
 participant MW as Middleware Pipeline
 participant MediaRoute as routes/media.js
 participant Aggregator as lib/media-aggregator.js
 participant PlexHelper as lib/plex-helpers.js
 participant JellyfinHelper as lib/jellyfin-helpers.js
 participant PlexSource as sources/plex.js
 participant JellyfinSource as sources/jellyfin.js
 participant Cache as utils/cache.js
 participant Logger as utils/logger.js

 Client->>Server: GET /get-media?type=movie&count=50
 Server->>MW: Process request

 MW->>MW: Authentication check
 MW->>MW: Rate limiting
 MW->>MW: Cache lookup
 MW->>MediaRoute: Forward request

 MediaRoute->>Aggregator: aggregateMedia(params)

 Aggregator->>PlexHelper: getPlexMedia(type, count)
 PlexHelper->>Cache: Check cache

 alt Cache Hit
 Cache-->>PlexHelper: Return cached data
 else Cache Miss
 PlexHelper->>PlexSource: fetchMedia(libraries, type, count)
 PlexSource-->>PlexHelper: Media items
 PlexHelper->>Cache: Store in cache
 end

 PlexHelper-->>Aggregator: Plex items

 Aggregator->>JellyfinHelper: getJellyfinMedia(type, count)
 JellyfinHelper->>Cache: Check cache

 alt Cache Hit
 Cache-->>JellyfinHelper: Return cached data
 else Cache Miss
 JellyfinHelper->>JellyfinSource: fetchMedia(libraries, type, count)
 JellyfinSource-->>JellyfinHelper: Media items
 JellyfinHelper->>Cache: Store in cache
 end

 JellyfinHelper-->>Aggregator: Jellyfin items

 Aggregator->>Aggregator: Merge, deduplicate, shuffle
 Aggregator->>Logger: Log aggregation metrics
 Aggregator-->>MediaRoute: Combined media array

 MediaRoute->>Cache: Store response cache
 MediaRoute-->>Server: JSON response
 Server-->>Client: 200 OK + media data

 Note over Client,Logger: Total time: ~100-500ms depending on cache hits
```

---

## WebSocket Architecture

Device communication and real-time control:

```mermaid
graph LR
 subgraph "Display Devices"
 D1[Device 1]
 D2[Device 2]
 D3[Device N]
 end

 subgraph "WebSocket Hub - utils/wsHub.js"
 WS[WebSocket Server]
 CM[Connection Manager]
 HB[Heartbeat Monitor]
 ACK[ACK Handler]
 end

 subgraph "Device Management"
 DS[Device Store]
 DH[lib/websocket-handlers.js]
 PR[lib/preset-helpers.js]
 end

 subgraph "Admin Control"
 AC[Admin Commands]
 GC[Group Commands]
 BC[Broadcast System]
 end

 D1 -.WebSocket.-> WS
 D2 -.WebSocket.-> WS
 D3 -.WebSocket.-> WS

 WS --> CM
 WS --> HB
 CM --> ACK

 CM <--> DS
 CM --> DH
 DH --> PR

 AC --> CM
 GC --> BC
 BC --> CM

 CM --> |Commands| D1
 CM --> |Commands| D2
 CM --> |Commands| D3

 D1 --> |ACK| ACK
 D2 --> |ACK| ACK
 D3 --> |ACK| ACK

 style WS fill:#4CAF50,stroke:#2E7D32,stroke-width:3px
 style CM fill:#2196F3,stroke:#1565C0,stroke-width:2px
 style DS fill:#FF9800,stroke:#E65100,stroke-width:2px
```

### WebSocket Message Flow

```mermaid
sequenceDiagram
 participant Admin
 participant Server as routes/devices.js
 participant WSHub as utils/wsHub.js
 participant Device as Display Device
 participant Handler as lib/websocket-handlers.js

 Admin->>Server: POST /api/devices/{id}/reboot
 Server->>WSHub: sendCommandAwait(deviceId, {type: 'reboot'})

 WSHub->>WSHub: Validate device connection
 WSHub->>Device: Send reboot command + msgId

 Note over WSHub,Device: Wait for ACK (default 10s timeout)

 alt Device responds
 Device->>Device: Execute reboot
 Device->>WSHub: ACK message with msgId
 WSHub->>Server: {success: true}
 Server->>Admin: 200 OK
 else Timeout
 WSHub->>Server: {success: false, error: 'timeout'}
 Server->>Admin: 504 Gateway Timeout
 end

 Note over Admin,Handler: Command types: reboot, reload, applySettings,<br/>mode, playlist, navigate
```

---

## Module Organization

Layered view of the codebase structure:

```mermaid
graph TB
 subgraph "Layer 0: Core Server"
 L0[server.js<br/>7,367 lines<br/>~25% of codebase]
 end

 subgraph "Layer 1: Routes (21 modules, ~13k lines, ~45%)"
 L1A[Admin Routes<br/>config, libraries, system]
 L1B[Device Routes<br/>devices, groups, QR]
 L1C[Media Routes<br/>media, playlists, local]
 L1D[Auth Routes<br/>auth, sessions, profile]
 L1E[Public Routes<br/>API, health, pages]
 end

 subgraph "Layer 2: Business Logic (14 modules, 4,479 lines, 23.8%)"
 L2A[Helpers<br/>plex, jellyfin, config]
 L2B[Aggregation<br/>media-aggregator, playlist-cache]
 L2C[WebSocket<br/>websocket-handlers]
 L2D[Utilities<br/>init, auth, utils]
 end

 subgraph "Layer 3: Middleware (Various)"
 L3A[Security<br/>auth, rateLimiter]
 L3B[Processing<br/>cache, validation]
 L3C[Observability<br/>metrics, errorHandler]
 end

 subgraph "Layer 4: Core Utilities"
 L4A[Cache System<br/>utils/cache.js]
 L4B[Logger<br/>utils/logger.js]
 L4C[Error Classes<br/>utils/errors.js]
 end

 subgraph "Layer 5: Data Sources"
 L5A[Plex Adapter<br/>sources/plex.js]
 L5B[Jellyfin Adapter<br/>sources/jellyfin.js]
 L5C[TMDB Adapter<br/>sources/tmdb.js]
 L5D[Local Adapter<br/>sources/local.js]
 end

 L0 --> L1A
 L0 --> L1B
 L0 --> L1C
 L0 --> L1D
 L0 --> L1E

 L1A --> L2A
 L1B --> L2C
 L1C --> L2B
 L1D --> L2D

 L2A --> L5A
 L2A --> L5B
 L2B --> L2A
 L2C --> L2D

 L1A --> L3A
 L1B --> L3A
 L1C --> L3B
 L1D --> L3A
 L1E --> L3B

 L3A --> L4B
 L3B --> L4A
 L3C --> L4B

 L2A --> L4A
 L2B --> L4A
 L5A --> L4B
 L5B --> L4B
 L5C --> L4B
 L5D --> L4C

 style L0 fill:#4CAF50,stroke:#2E7D32,stroke-width:4px
 style L1A fill:#2196F3,stroke:#1565C0,stroke-width:2px
 style L1B fill:#2196F3,stroke:#1565C0,stroke-width:2px
 style L1C fill:#2196F3,stroke:#1565C0,stroke-width:2px
 style L2A fill:#FF9800,stroke:#E65100,stroke-width:2px
 style L2B fill:#FF9800,stroke:#E65100,stroke-width:2px
 style L4A fill:#9C27B0,stroke:#6A1B9A,stroke-width:2px
 style L4B fill:#9C27B0,stroke:#6A1B9A,stroke-width:2px
```

---

## Authentication & Authorization Flow

```mermaid
sequenceDiagram
 participant Client
 participant Server
 participant AuthRoute as routes/auth.js
 participant AuthMiddleware as middleware/adminAuth.js
 participant SessionStore as express-session
 participant BCrypt as bcrypt
 participant Config as config.json

 Client->>Server: POST /admin/login
 Server->>AuthRoute: Route handler
 AuthRoute->>Config: Load admin credentials
 Config-->>AuthRoute: {username, password_hash, totpSecret}

 alt 2FA Enabled
 AuthRoute->>Client: Require 2FA token
 Client->>AuthRoute: Send token
 AuthRoute->>AuthRoute: Verify TOTP token
 end

 AuthRoute->>BCrypt: Compare password

 alt Valid credentials
 BCrypt-->>AuthRoute: Match
 AuthRoute->>SessionStore: Create session
 SessionStore-->>AuthRoute: sessionId
 AuthRoute->>Client: Set-Cookie: sessionId
 Client-->>AuthRoute: 200 OK {success: true}
 else Invalid credentials
 BCrypt-->>AuthRoute: No match
 AuthRoute->>Client: 401 Unauthorized
 end

 Note over Client,Config: Subsequent requests

 Client->>Server: GET /api/config (protected)
 Server->>AuthMiddleware: Verify session
 AuthMiddleware->>SessionStore: Check session validity

 alt Valid session
 SessionStore-->>AuthMiddleware: Valid
 AuthMiddleware->>Server: Continue
 Server->>Client: 200 OK + data
 else Invalid/Expired session
 SessionStore-->>AuthMiddleware: Invalid
 AuthMiddleware->>Client: 401 Unauthorized
 end
```

---

## Caching Architecture

Multi-tier caching strategy for optimal performance:

```mermaid
graph TB
 subgraph "Request Layer"
 REQ[Incoming Request]
 end

 subgraph "Tier 1: HTTP Headers"
 ETAG[ETag Validation]
 MODIFIED[Last-Modified Check]
 CACHE_CONTROL[Cache-Control Headers]
 end

 subgraph "Tier 2: Memory Cache - utils/cache.js"
 MEM[In-Memory Store<br/>Fast, Volatile]
 TTL[TTL Management]
 EVICT[LRU Eviction]
 end

 subgraph "Tier 3: Disk Cache"
 DISK[File System Cache<br/>cache/ directory]
 PERSIST[Persistence Layer]
 end

 subgraph "Tier 4: Source Data"
 PLEX[Plex API]
 JELLYFIN[Jellyfin API]
 TMDB[TMDB API]
 LOCAL[Local Files]
 end

 REQ --> ETAG
 ETAG -->|Match| RETURN304[304 Not Modified]
 ETAG -->|No Match| MODIFIED
 MODIFIED -->|Not Modified| RETURN304
 MODIFIED -->|Modified| CACHE_CONTROL

 CACHE_CONTROL --> MEM
 MEM -->|Hit| FAST[Fast Return]
 MEM -->|Miss| TTL
 TTL -->|Valid| FAST
 TTL -->|Expired/Miss| DISK

 DISK -->|Hit| MED[Medium Return]
 DISK -->|Miss| PERSIST
 PERSIST --> PLEX
 PERSIST --> JELLYFIN
 PERSIST --> TMDB
 PERSIST --> LOCAL

 PLEX --> STORE[Store in all tiers]
 JELLYFIN --> STORE
 TMDB --> STORE
 LOCAL --> STORE

 STORE --> DISK
 STORE --> MEM
 STORE --> EVICT

 style MEM fill:#4CAF50,stroke:#2E7D32,stroke-width:3px
 style DISK fill:#2196F3,stroke:#1565C0,stroke-width:2px
 style FAST fill:#8BC34A,stroke:#558B2F,stroke-width:2px
 style RETURN304 fill:#8BC34A,stroke:#558B2F,stroke-width:2px
```

### Cache TTL Strategy

| Data Type        | Memory TTL | Disk TTL   | Reasoning                 |
| ---------------- | ---------- | ---------- | ------------------------- |
| Media Posters    | 1 hour     | 7 days     | Images rarely change      |
| Library Metadata | 5 minutes  | 1 hour     | Frequent updates possible |
| Playlist Data    | 2 minutes  | 15 minutes | Dynamic content           |
| Device Settings  | 1 minute   | N/A        | Real-time updates needed  |
| Config Data      | 30 seconds | N/A        | Admin changes immediate   |

---

## Device Lifecycle

State management for display devices:

```mermaid
stateDiagram-v2
 [*] --> Unpaired: Device boots

 Unpaired --> PairingRequested: Request pairing code
 PairingRequested --> PairingPending: Display QR code
 PairingPending --> Paired: Admin approves
 PairingPending --> Unpaired: Code expires (5 min)

 Paired --> Connected: WebSocket established
 Connected --> Active: Receiving media

 Active --> Idle: No activity timer
 Idle --> Active: User interaction / New content

 Active --> Disconnected: Connection lost
 Disconnected --> Connected: Reconnect successful
 Disconnected --> Unpaired: Unpair command / Auth failure

 Connected --> Updating: Firmware update
 Updating --> Connected: Update complete
 Updating --> Error: Update failed

 Error --> Connected: Retry successful
 Error --> Unpaired: Manual reset

 Paired --> Unpaired: Admin unpairs
 Connected --> Unpaired: Admin unpairs
 Active --> Unpaired: Admin unpairs

 note right of PairingPending
 5-minute expiration window
 6-digit alphanumeric code
 end note

 note right of Active
 Heartbeat every 30s
 Timeout after 3 missed beats
 end note

 note right of Updating
 Atomic updates with rollback
 Version compatibility checks
 end note
```

---

## Metrics & Observability

Data flow for monitoring and metrics:

```mermaid
graph LR
 subgraph "Request Events"
 R1[HTTP Requests]
 R2[WebSocket Messages]
 R3[Background Jobs]
 end

 subgraph "Middleware - middleware/metrics.js"
 M1[Request Counter]
 M2[Response Timer]
 M3[Error Tracker]
 end

 subgraph "Metrics Store - utils/metrics.js"
 MS[Metrics Aggregator]
 MC[Metric Categories]
 end

 subgraph "Sources Metrics"
 SM1[Plex Metrics]
 SM2[Jellyfin Metrics]
 SM3[Cache Metrics]
 end

 subgraph "Logging - utils/logger.js"
 L1[Winston Logger]
 L2[File Transport]
 L3[Console Transport]
 L4[Memory Buffer]
 end

 subgraph "Admin Interface"
 A1[/api/admin/metrics]
 A2[/api/admin/logs/stream]
 A3[/api/health]
 end

 R1 --> M1
 R2 --> M1
 R3 --> M1

 M1 --> M2
 M2 --> M3
 M3 --> MS

 SM1 --> MS
 SM2 --> MS
 SM3 --> MS

 MS --> MC
 MC --> A1

 M1 --> L1
 M2 --> L1
 M3 --> L1

 L1 --> L2
 L1 --> L3
 L1 --> L4

 L4 --> A2
 MS --> A3

 style MS fill:#4CAF50,stroke:#2E7D32,stroke-width:3px
 style L1 fill:#2196F3,stroke:#1565C0,stroke-width:2px
 style MC fill:#FF9800,stroke:#E65100,stroke-width:2px
```

---

## Deployment Architecture

Production environment setup:

```mermaid
graph TB
 subgraph "Load Balancer Layer"
 LB[Nginx/Traefik]
 end

 subgraph "Application Layer"
 PM2[PM2 Process Manager]
 APP1[Posterrama Instance 1<br/>Port 4000]
 APP2[Posterrama Instance 2<br/>Port 4001]
 end

 subgraph "Data Layer"
 CONFIG[Config Files<br/>config.json, devices.json]
 CACHE[Cache Directory<br/>image_cache/]
 LOGS[Log Files<br/>logs/]
 SESSIONS[Session Store<br/>sessions/]
 end

 subgraph "External Services"
 PLEX[Plex Media Server]
 JELLYFIN[Jellyfin Server]
 TMDB[TMDB API]
 end

 LB --> APP1
 LB --> APP2

 PM2 --> APP1
 PM2 --> APP2

 APP1 --> CONFIG
 APP1 --> CACHE
 APP1 --> LOGS
 APP1 --> SESSIONS

 APP2 --> CONFIG
 APP2 --> CACHE
 APP2 --> LOGS
 APP2 --> SESSIONS

 APP1 --> PLEX
 APP1 --> JELLYFIN
 APP1 --> TMDB

 APP2 --> PLEX
 APP2 --> JELLYFIN
 APP2 --> TMDB

 style PM2 fill:#4CAF50,stroke:#2E7D32,stroke-width:3px
 style APP1 fill:#2196F3,stroke:#1565C0,stroke-width:2px
 style APP2 fill:#2196F3,stroke:#1565C0,stroke-width:2px
```

---

## Development vs Production

```mermaid
graph LR
 subgraph "Development Mode"
 DEV1[NODE_ENV=development]
 DEV2[Verbose Logging]
 DEV3[Hot Reload]
 DEV4[No Cache Persistence]
 DEV5[Debug Endpoints]
 end

 subgraph "Production Mode"
 PROD1[NODE_ENV=production]
 PROD2[Info/Error Only Logging]
 PROD3[PM2 Clustering]
 PROD4[Full Cache Persistence]
 PROD5[Protected Endpoints]
 end

 DEV1 -.Switch ENV.-> PROD1
 DEV2 -.Configure Logger.-> PROD2
 DEV3 -.PM2 Restart.-> PROD3
 DEV4 -.Enable Persistence.-> PROD4
 DEV5 -.Apply Auth.-> PROD5

 style DEV1 fill:#FFC107,stroke:#F57C00,stroke-width:2px
 style PROD1 fill:#4CAF50,stroke:#2E7D32,stroke-width:3px
```

---

## Related Documentation

- [MODULE-ARCHITECTURE.md](./MODULE-ARCHITECTURE.md) - Detailed module structure
- [DEPENDENCY-GRAPH.md](./DEPENDENCY-GRAPH.md) - Module dependency mapping
- [DEVELOPMENT.md](./DEVELOPMENT.md) - Development setup
- [SERVER-REFACTORING-PLAN.md](./SERVER-REFACTORING-PLAN.md) - Refactoring history

---

## Diagram Maintenance

**Update these diagrams when**:

- Adding new routes or modules
- Changing request flow patterns
- Modifying WebSocket behavior
- Updating caching strategy
- Adding new data sources
- Changing authentication flow
- Altering deployment architecture

**Tools for editing**:

- [Mermaid Live Editor](https://mermaid.live/) - Online diagram editor
- VS Code Extension: `bierner.markdown-mermaid` - Preview in editor
- GitHub - Native Mermaid rendering in markdown

---

**Document Version**: 1.0.0
**Last Review**: 2025-01-20
**Next Review**: When adding new major features
