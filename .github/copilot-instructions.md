# Posterrama Repository - AI Agent Onboarding Guide

## Repository Overview

**Posterrama** is a Node.js/Express media server aggregation application (v1.9.5) that provides unified poster galleries from multiple media sources. It acts as a centralized interface for browsing movies and TV shows across Plex, Jellyfin, TMDB, and TVDB libraries with intelligent caching, filtering, and responsive design.

### Key Features

- **Multi-Source Integration**: Plex, Jellyfin, TMDB, TVDB with unified API endpoints
- **Advanced Caching**: Memory, disk, and HTTP caching with intelligent invalidation
- **Admin Interface**: Full configuration management, server monitoring, and genre filtering
- **Image Processing**: Lazy loading, optimization, fallback handling with custom SVG placeholders
- **API Documentation**: Comprehensive Swagger/OpenAPI documentation at `/api-docs`
- **Production Ready**: PM2 process management, comprehensive logging, health checks

## Build & Development Workflow

### Prerequisites

- **Node.js**: >=18.0.0 (confirmed working with Node 18+)
- **npm**: Package management and script execution
- **PM2**: Production process management (optional for development)

### Essential Commands

**Development Workflow:**

```bash
npm install           # Install dependencies (681 total packages)
npm start            # Start development server on http://localhost:4000
npm test             # Run 681 tests across 47 suites (expect some failures)
npm run lint         # ESLint code quality checks (expect 20+ errors currently)
npm run format       # Prettier code formatting (auto-fix)
```

**Quality Assurance:**

```bash
npm run test:coverage      # Generate test coverage reports (target: 87%+)
npm run quality:all       # Complete quality pipeline (lint + format + test + security)
npm run deps:audit        # Security vulnerability scanning (8 known vulnerabilities)
npm run deps:health       # Dependency health analysis
```

**Production Deployment:**

```bash
npm run release:patch     # Automated patch release with git tagging
npm run push             # Deploy to production without version bump
```

### Known Build Issues

**Critical Warnings:**

1. **Test Failures**: 18/825 tests currently failing (primarily metrics and filter efficiency tests)
2. **ESLint Errors**: 20 errors in `public/admin.js`, `server.js`, and `sources/jellyfin.js`
3. **Security Vulnerabilities**: 8 npm audit issues (6 moderate, 2 critical) in plex-api dependencies
4. **Coverage Gaps**: Several source files below coverage thresholds (tmdb.js, tvdb.js, plex.js)

**Build Recommendations:**

- Use `npm run lint:fix` for auto-fixable ESLint issues
- Run `npm run format` before committing to ensure consistent code style
- Test failures are primarily in metrics calculation - functional code works correctly
- Security vulnerabilities are in legacy Plex API dependencies - consider updating

## Project Architecture

### Directory Structure

```
├── server.js                 # Main Express application entry point
├── config/                   # Configuration management and validation
├── sources/                  # Media source integrations (Plex, Jellyfin, TMDB, TVDB)
├── utils/                    # Shared utilities (caching, logging, health checks)
├── middleware/               # Express middleware (auth, validation, rate limiting)
├── public/                   # Frontend assets (admin interface, client-side JavaScript)
├── __tests__/                # Comprehensive test suite (681 tests, 47 suites)
├── scripts/                  # Development and maintenance scripts
├── .github/                  # GitHub Actions CI/CD pipeline
└── docs/                     # Development and contribution documentation
```

### Core Components

**Backend Architecture:**

- **server.js**: Express app with 50+ API endpoints, middleware pipeline, PM2 integration
- **sources/**: Modular media source adapters with unified interface pattern
- **utils/cache.js**: Multi-tier caching (memory/disk) with TTL and size management
- **middleware/**: Authentication, validation, rate limiting, error handling pipeline

**Frontend Stack:**

- **Vanilla JavaScript**: No framework dependencies, direct DOM manipulation
- **admin.html/css/js**: Full-featured admin interface with real-time monitoring
- **Responsive Design**: Multi-device support with CSS Grid/Flexbox layouts
- **PWA Features**: Service worker, manifest, offline capabilities

**Testing Framework:**

- **Jest**: 30-second timeout, 87.53% coverage target, parallel execution
- **Integration Tests**: Full API endpoint coverage with mocked external services
- **Performance Tests**: Memory leak detection, caching efficiency validation
- **Source-Specific Tests**: Dedicated test suites for each media source integration

### Configuration Management

**Primary Config Files:**

- `config.json`: Runtime configuration (auto-created from `config.example.json`)
- `config.schema.json`: JSON schema validation for configuration structure
- `ecosystem.config.js`: PM2 process management configuration
- `.env` files: Environment-specific variables (development/production)

**Key Configuration Areas:**

- Media source credentials and endpoints
- Caching strategies and TTL values
- Admin authentication and security settings
- Logging levels and output destinations
- API rate limiting and timeout configurations

### CI/CD Pipeline

**GitHub Actions Workflow** (`.github/workflows/ci.yml`):

- **Triggers**: Push to main, pull requests, manual dispatch
- **Node.js Versions**: 18.x, 20.x matrix testing
- **Pipeline Steps**: Install dependencies → Run tests → ESLint checks → Build validation
- **Quality Gates**: Test passage required, lint warnings acceptable
- **Deployment**: Automated with release scripts and PM2 process management

**Quality Standards:**

- ESLint + Prettier code formatting enforcement
- Jest test coverage requirements (87%+ target)
- Automated dependency vulnerability scanning
- PR template enforcement for contribution quality

## Development Best Practices

### Common Development Tasks

**Adding New Media Sources:**

1. Create adapter in `sources/` following existing pattern (plex.js, jellyfin.js)
2. Implement required methods: `fetchMedia()`, `getMetrics()`, `resetMetrics()`
3. Add comprehensive test suite in `__tests__/sources/`
4. Update server.js API endpoints for new source integration
5. Extend admin interface for source configuration

**API Endpoint Development:**

1. Add route definitions in server.js (follow existing `/api/v1/` pattern)
2. Implement middleware pipeline (validation, authentication, rate limiting)
3. Add Swagger documentation annotations for auto-generated API docs
4. Create integration tests in `__tests__/api/`
5. Validate with admin interface and external API consumers

**Frontend Enhancements:**

1. Modify `public/admin.html` for UI structure changes
2. Update `public/admin.css` for styling (CSS Grid/Flexbox patterns)
3. Extend `public/admin.js` for functionality (avoid ESLint violations)
4. Test responsive design across device sizes
5. Validate PWA features and offline functionality

### Debugging Guidelines

**Common Issues:**

- **Image Loading Failures**: Check `image_cache/` directory permissions and network connectivity
- **API Authentication**: Verify media source credentials in config.json
- **Memory Issues**: Monitor cache sizes and enable disk-based caching for large datasets
- **Performance**: Use `npm run test:coverage` to identify bottlenecks in caching logic

**Logging Locations:**

- Application logs: `logs/` directory with rotation
- PM2 logs: `~/.pm2/logs/` for production deployment
- Test output: Jest console output with detailed error reporting
- Admin interface: Real-time log viewing with filtering capabilities

### Contributing Workflow

1. **Fork & Clone**: Standard GitHub workflow with feature branches
2. **Development**: Follow ESLint/Prettier rules, maintain test coverage
3. **Testing**: Run full test suite, verify no regressions in core functionality
4. **Documentation**: Update API docs, configuration examples, and README
5. **Pull Request**: Use provided PR template, ensure CI pipeline passes

# Posterrama Development Context

## 🚀 Server Configuration

### Port Information

- **Main Server Port**: `4000` (default)
    - Configurable via `process.env.SERVER_PORT` or `config.serverPort` in config.json
    - Server accessible at: `http://localhost:4000`
    - API endpoints: `http://localhost:4000/get-media`, `http://localhost:4000/health`, etc.

### Environment Variables

- `SERVER_PORT`: Override default port (default: 4000)
- `DEBUG`: Enable debug logging (`true`/`false`)
- `NODE_ENV`: Environment mode (`production`, `development`, `test`)

## 🔧 Quick Commands for Development

### Testing the Application

```bash
# Test main endpoints
curl http://localhost:4000/health
curl http://localhost:4000/get-media
curl http://localhost:4000/get-config

# Test admin endpoints (requires authentication)
curl http://localhost:4000/admin
```

### PM2 Process Management

```bash
pm2 list                    # Show running processes
pm2 restart posterrama     # Restart the application
pm2 logs posterrama        # View logs
pm2 stop posterrama        # Stop the application
pm2 start posterrama       # Start the application
```

**Remember**: Server runs on port **4000** by default!

---

_Last Updated: August 2025 | Repository Version: 1.9.5_
_For detailed development setup: see `docs/DEVELOPMENT.md`_
_For contribution guidelines: see `docs/CONTRIBUTING.md`_
