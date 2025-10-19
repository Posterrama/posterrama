# Development Roadmap

Current development status and upcoming features for Posterrama.

## 📊 Current Status (v2.8.0 - October 19, 2025)

### Recent Releases

**v2.8.0 (Latest)** - October 19, 2025

- ✅ Install script now automatically detects existing installations
- ✅ Single command for both fresh install and updates (`curl -fsSL ... | bash`)
- ✅ Automatic config backup with timestamp before updates
- ✅ Promo site overlay architecture refactored
- ✅ Media directory structure always created on startup
- ✅ Git hard reset ensures clean state during updates
- ✅ PM2 service user auto-detection (root or posterrama)
- ✅ Shellcheck warnings resolved in install scripts
- ✅ Code coverage: 92.23% (1252/1253 tests passing)

**v2.7.9** - October 17, 2025

- ✅ Coverage documentation improvements
- ✅ CI/CD badge updates

### Quality Metrics

- **Code Coverage**: 92.23% (Statements: 92.23%, Branches: 81.20%, Functions: 91.35%, Lines: 93.45%)
- **Tests**: 1252 passing, 1 skipped (150 test suites)
- **Security**: All audits passing (accepted Plex API risks documented)
- **CI/CD**: GitHub Actions fully automated
- **Node.js**: v18.20.8+ (v18+ required)

### Installation & Setup

- [x] **Smart install/update script** - Automatically detects fresh install vs update
- [x] **Config backup system** - Timestamped backups before updates
- [x] **PM2 process management** - Production-ready deployment
- [x] **Automated directory creation** - Media folders always created on startup
- [ ] Provide `device-presets.json` as a template on first boot, then allow adding custom presets

### Media Sources

- [ ] Emby integration
- [ ] Additional poster services
- [ ] Music library support (reuse existing sources; define display options)
- [ ] Radarr/Sonarr/Lidarr integration
- [ ] Steam and ROMM gaming libraries and collections

### Modes

- [x] **Promo site overlay system** - Dynamic injection on top of mode pages
- [x] **Device management control** - Disabled on promo site
- [ ] Split each mode into its own HTML + minimal CSS (simpler maintenance)
    - [x] `screensaver.html` - Core functionality complete
    - [x] `cinema.html` - Core functionality complete
    - [x] `wallart.html` - Core functionality complete with promo overlay support

### Responsive Design

- [ ] Mobile

### UI/UX Improvements

- [ ] Poster hints from Posterr
- [ ] MoviePosterApp.com features:
    - [ ] Advanced transition effects
    - [ ] Font/size/color customization
    - [ ] Trailer support
- [ ] Motion posters with AI
- [ ] Now playing mode (cinema)
- [ ] Curated playlists (franchises, directors, genres, "On this day", "New to Plex"), actors

### Device Management

- [ ] Multiple screens with smart sync and coordinated displays
- [ ] Online poster services; orientation-aware selection

### Display Behavior

- [ ] Slide animation: faster transition, longer still time
- [ ] Wallart: option to show metadata (Title, Year, Stars) — hero-only or all posters
- [ ] Wallart: add film card layout
- [ ] Cinema: film card / presets

### Rules & Schedules

- [ ] Time schedules (day/night, weekends); scenes as presets; seasonal themes (Halloween, Holidays)
- [ ] Sound and ambient modes
- [ ] Music visuals for audio libraries; ambient background for idle

## 🏗️ Technical Debt

### JavaScript Modularization

Current monolithic files need refactoring:

- `admin.js` (7,754 lines) → Split into modules
- `script.js` (2,760 lines) → Component-based architecture

**Recent Improvements (v2.8.0):**

- ✅ Promo overlay system modularized (`public/promo/promo-box-overlay.js`)
- ✅ Separate CSS modules for promo styling (`public/promo/promo-box.css`)
- ✅ Core utilities refactored with `Core.loadPromoOverlay()`
- ✅ Install script refactored with detection and update functions

**Target structure:**

```
js/
├── modules/
│   ├── state/           # State management
│   ├── ui/              # UI components
│   ├── media/           # Media handling
│   └── wallart/         # Wallart mode logic
├── admin/               # Admin interface
├── promo/               # Promo overlay (✅ COMPLETE)
└── screensaver/         # Main display logic
```

**Goals:**

- No file >500 lines
- Single responsibility per module
- Maintain performance
- ✅ Promo system follows single responsibility pattern

### Code Quality & Testing

**Achievements:**

- ✅ 92.23% code coverage maintained
- ✅ Pre-commit hooks enforce formatting and linting
- ✅ Shellcheck validation on shell scripts
- ✅ Automated quality checks in CI/CD
- ✅ Release-check script validates before deployment

**Ongoing:**

- [ ] Increase branch coverage to 85%+ (currently 81.20%)
- [ ] Add integration tests for install script
- [ ] Performance benchmarking suite

### Performance Optimizations

- [x] **Cache management** - Multi-tier caching system implemented
- [x] **Asset stamping** - Cache busting with Date.now() timestamps
- [ ] Lazy loading for non-critical modules
- [ ] Image optimization pipeline

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

### Smart TV Enhancements

- [ ] Android TV native app
- [ ] Apple TV screensaver integration
- [ ] Samsung Tizen app
- [ ] LG webOS integration

### Home Automation

- [ ] Home Assistant integration
- [ ] MQTT support for IoT
    - [ ] Entities (state, source, playing)
    - [ ] Automations (dim/pause on presence)
    - [ ] Topics for remote control

## 🔐 Security & Reliability

### Security Audit

**Current Status (v2.8.0):**

- ✅ Security audit passing (npm audit with filtered risks)
- ✅ Accepted Plex API dependency vulnerabilities documented
- ✅ No new actionable vulnerabilities
- ✅ Shellcheck validation on all shell scripts
- ✅ Pre-push quality checks prevent insecure code

**Accepted Risks:**

- Plex API dependencies (plex-api, request, xml2js) - Breaking changes if updated
- Documented in `docs/DEPENDENCY-MANAGEMENT.md`

### Authentication

- [x] **Session management** - Secure session handling with auto-generated secrets
- [x] **PM2 integration** - Automatic session secret generation under PM2
- [ ] LDAP/Active Directory integration
- [ ] OAuth providers (Google, GitHub)
- [ ] Role-based access control

### Device Identity

- [x] **Device pairing system** - Secure pairing with codes
- [x] **Device store** - JSON-backed registry with secret hashing
- [x] **WebSocket authentication** - Device verification for WS connections
- [ ] Make each device unique (e.g., bind a client certificate)

## 🎬 Cinema Mode Enhancements

- [ ] Film card / presets for cinema mode

## ✨ Customization & Design

- [ ] Inverted high‑contrast font option (like Q dep / untamed style)

---

## 🚀 Deployment & Operations

### Installation Methods

**Current (v2.8.0):**

```bash
# Single command for both fresh install and updates
curl -fsSL https://raw.githubusercontent.com/Posterrama/posterrama/main/install.sh | bash
```

**Features:**

- ✅ Automatic detection of existing installations
- ✅ Fresh install mode when no installation found
- ✅ Update mode when existing installation detected
- ✅ Automatic config backup with timestamp
- ✅ Git hard reset for clean updates
- ✅ PM2 service user auto-detection (root or posterrama)
- ✅ Dependency installation (Node.js, PM2, Git, build tools)
- ✅ Firewall configuration (UFW/firewalld)
- ✅ Systemd service setup

**Additional Scripts:**

- `proxmox-install.sh` - Proxmox-specific installation
- `install.sh` - Universal Linux installer (Ubuntu, Debian, CentOS, RHEL, Rocky, AlmaLinux, Fedora)

### Continuous Integration

**GitHub Actions Workflows:**

- ✅ `ci.yml` - Code quality, tests, security audit, build
- ✅ `codeql.yml` - Security analysis
- ✅ `coverage-docs.yml` - Coverage documentation updates
- ✅ `regression-tests.yml` - API contract validation
- ✅ `release.yml` - Automated releases
- ✅ `release-summary.yml` - Release documentation

**Pre-commit Hooks:**

- ✅ Prettier formatting
- ✅ ESLint validation
- ✅ Quality checks

**Pre-push Hooks:**

- ✅ Syntax validation
- ✅ File structure checks
- ✅ Quick regression tests
- ✅ API contract validation

### Release Process

**Current Status:**

- ✅ Automated release-check script (`scripts/release-check.sh`)
- ✅ Version bumping in package.json and README.md
- ✅ Git tagging with detailed release notes
- ✅ Quality validation before push
- ✅ Regression testing integrated

**Release Checklist (Automated):**

1. ✅ All tests passing (1252/1253)
2. ✅ Code coverage >92%
3. ✅ ESLint & Prettier checks
4. ✅ Security audit clean
5. ✅ Config schema validation
6. ✅ API documentation up-to-date
7. ✅ Pre-commit hooks active
8. ✅ Shellcheck validation

### Monitoring & Maintenance

**Current:**

- ✅ Health check endpoint (`/health`)
- ✅ Metrics collection and reporting
- ✅ PM2 process management with auto-restart
- ✅ Automated log rotation
- ✅ Config backup system with scheduling

**Future:**

- [ ] Prometheus metrics export
- [ ] Grafana dashboard templates
- [ ] Alerting system integration
- [ ] Automatic update notifications
