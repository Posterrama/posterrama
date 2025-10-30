# Development Roadmap

Open items and planned features for Posterrama (v2.8.8+).

## 📊 Current Status

**Version**: 2.8.8  
**Code Coverage**: 86.89% statements (2819/3244 lines)  
**Tests**: 2,121/2,124 passing (99.86%)  
**Test Suites**: 177/178 passing (99.44%)  
**Node.js**: v18+ required

### Recent Achievements (October 2025)

- ✅ **Server Modularization**: 70.2% reduction achieved (19,864 → 5,919 lines)
- ✅ **E2E Test Suite**: 42 comprehensive end-to-end tests added
    - Multi-source media aggregation (11 tests)
    - Device workflows with grouping & WebSocket (8 tests)
    - Admin UI workflows (23 tests)
- ✅ **Device Presets**: Template system implemented (`device-presets.example.json`)
- ✅ **Responsive Design**: Mobile-optimized admin interface with viewport meta tags
- ✅ **Image Optimization**: Lazy loading with Intersection Observer API
- ✅ **Performance**: Benchmarking suite for critical paths

## 📋 Open Items

### Installation & Setup

- [x] ~~Provide `device-presets.json` as a template on first boot~~ ✅ **DONE** - `device-presets.example.json` available
- [ ] Allow adding custom presets via admin UI

### Media Sources

- [ ] Emby integration
- [ ] Additional poster services
- [ ] Music library support (reuse existing sources; define display options)
- [ ] Radarr/Sonarr/Lidarr integration
- [ ] Steam and ROMM gaming libraries and collections

### Responsive Design

- [x] ~~Mobile optimization~~ ✅ **DONE** - Admin UI fully responsive with media queries
    - Viewport meta tags on all pages
    - Mobile navigation toggle
    - Responsive breakpoints (640px, 1024px)
    - Touch-friendly controls

### UI/UX Improvements

- [ ] Poster hints from Posterr
- [ ] MoviePosterApp.com features:
    - [ ] Advanced transition effects
    - [ ] Font/size/color customization
    - [ ] Trailer support
- [ ] Motion posters with AI
- [ ] Now playing mode (cinema)
- [ ] Curated playlists (franchises, directors, genres, "On this day", "New to Plex", actors)

### Device Management

- [ ] Multiple screens with smart sync and coordinated displays
- [ ] Online poster services with orientation-aware selection

### Display Behavior

- [ ] Slide animation: faster transition, longer still time
- [ ] Wallart: option to show metadata (Title, Year, Stars) — hero-only or all posters
- [ ] Wallart: add film card layout
- [ ] Cinema: film card / presets

### Rules & Schedules

- [ ] Time schedules (day/night, weekends)
- [ ] Scenes as presets
- [ ] Seasonal themes (Halloween, Holidays)
- [ ] Sound and ambient modes
- [ ] Music visuals for audio libraries
- [ ] Ambient background for idle

## 🏗️ Technical Debt

### JavaScript Modularization

- [x] ~~Refactor `server.js`~~ ✅ **DONE** - Reduced from 19,864 to 5,919 lines (70.2%)
    - 17 route modules extracted
    - 14 library modules extracted
    - Factory pattern with dependency injection
- [ ] Refactor `admin.js` (7,754 lines) into modules
- [ ] Refactor `script.js` (2,760 lines) into component-based architecture
- [ ] Target: No file >500 lines, single responsibility per module

### Performance Optimizations

- [x] ~~Image optimization pipeline~~ ✅ **DONE** - Lazy loading with Intersection Observer
    - 50px preload margin
    - Retry mechanism (max 3 attempts)
    - Fallback SVG placeholders
- [x] ~~Performance benchmarking~~ ✅ **DONE** - Comprehensive benchmark suite
    - Endpoint response times
    - Memory usage monitoring
    - Cache performance metrics
    - Concurrent request handling
- [ ] Lazy loading for non-critical modules (dynamic imports)

## 🎨 Wallart Mode Enhancements

### Animation System

- [ ] Theme-based layouts (genre-specific grids)
- [ ] Decade themes (80s neon, 90s grunge, etc.)
- [ ] Weather-based themes
- [ ] Time-of-day adaptive layouts

### Advanced Features

- [ ] 3D perspective effects
- [ ] Particle systems
- [ ] Interactive hover states
- [ ] AI-powered layout optimization

## 📱 Platform Integration

### Smart TV

- [ ] Android TV native app
- [ ] Apple TV screensaver integration
- [ ] Samsung Tizen app
- [ ] LG webOS integration

### Home Automation (MQTT)

- [ ] Complete settings testing (all 30+ settings end-to-end)
- [x] ~~Broadcast commands via MQTT~~ ✅ **DONE** - Group command broadcasting implemented
- [ ] Group controls integration (groups.json → virtual HA devices)
- [ ] Server metrics sensors (cache size, memory usage, device count)
- [ ] Event notifications (device connect/disconnect, library updates)
- [x] ~~End-to-end integration tests with real MQTT broker~~ ✅ **DONE** - E2E suite available

## 🔐 Security & Authentication

### Authentication

- [ ] LDAP/Active Directory integration
- [ ] OAuth providers (Google, GitHub)
- [ ] Role-based access control

### Device Identity

- [ ] Make each device unique (e.g., bind a client certificate)

## 🎬 Cinema Mode

- [ ] Film card / presets for cinema mode

## ✨ Customization & Design

- [ ] Inverted high-contrast font option (like Q dep / untamed style)

## 🚀 Monitoring & Operations

- [x] ~~Performance benchmarks~~ ✅ **DONE** - Comprehensive benchmark test suite
    - Health check: <50ms target
    - Config fetch: <100ms target
    - Cache operations: <10ms read, <50ms write
    - Memory leak detection
- [ ] Prometheus metrics export
- [ ] Grafana dashboard templates
- [ ] Alerting system integration
- [ ] Automatic update notifications

## 🧪 Testing & Quality Assurance

### Test Coverage Status

- **Overall**: 86.89% statement coverage
- **Tests**: 2,121 passing (99.86%)
- **Test Suites**: 177 passing (99.44%)

### Test Categories

- [x] ~~Unit tests~~ ✅ **DONE** - Comprehensive coverage
- [x] ~~Integration tests~~ ✅ **DONE** - Route module integration
- [x] ~~E2E tests~~ ✅ **DONE** - 42 end-to-end tests
    - Multi-source media aggregation
    - Device lifecycle & grouping
    - Settings inheritance & overrides
    - WebSocket command delivery
    - Admin workflows (config, library scanning)
- [x] ~~Performance tests~~ ✅ **DONE** - Benchmark suite
- [x] ~~Regression tests~~ ✅ **DONE** - Critical path validation

### Known Issues

- [ ] Fix preset-helpers test (1 failing test - process.cwd() isolation)
- [ ] Reach 85% branch coverage (currently 76.41%)

## 📝 Documentation

### Completed

- [x] ~~API documentation~~ ✅ **DONE** - Swagger/OpenAPI at `/api-docs`
- [x] ~~Module architecture~~ ✅ **DONE** - MODULE-ARCHITECTURE.md
- [x] ~~Refactoring progress~~ ✅ **DONE** - REFACTORING-PROGRESS.md
- [x] ~~Test documentation~~ ✅ **DONE** - TEST-REFACTORING-SUMMARY.md

### Pending

- [ ] User guide (installation, configuration)
- [ ] Developer guide (contributing, architecture)
- [ ] API client examples (Python, JavaScript)
- [ ] Deployment guides (Docker, Proxmox, bare metal)
