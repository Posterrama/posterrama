# Posterrama v2.9.5 Release Notes

**Release Date:** November 16, 2025

This is a major maintenance and quality release with significant improvements to testing infrastructure, performance, reliability, and code quality. Over 200 commits have been made since v2.9.4, focusing on production readiness, test coverage improvements, and critical bug fixes.

---

## 🐛 Critical Bug Fixes

### Middleware & Response Handling

- **Fixed metricsMiddleware bug causing test timeouts** - Early return on 401 responses prevented `res.end()` from being called, causing HTTP responses to hang indefinitely
- **Fixed file locking in test environment** - Disabled SafeFileStore file locking when `NODE_ENV=test` to prevent test hangs
- **Fixed ESLint empty catch block error** in device management UI
- **Fixed 401 warning spam** - Skip 401 warnings for all admin endpoints to reduce log noise

### Configuration & Backend

- **Fixed config module import collision** - Resolved conflicts between config class and config.json imports
- **Fixed Config class implementation** - Added proper getters for config.json properties and updated internal config object references
- **Fixed unnecessary PM2 restarts** - Only restart when port actually changes, not on every Operations save
- **Fixed response timing** - Send HTTP response before PM2 restart to prevent 502 errors

### Media Source Integrations

- **Fixed Jellyfin library matching** - Use `ItemId` instead of `Id` for proper library identification
- **Fixed Jellyfin genres endpoint** - Always call API even with no libraries selected, add library fallback
- **Fixed RomM password persistence** - Add `originalToken` tracking to prevent credential loss on page reload
- **Fixed cross-browser admin access** - Use backend credentials fallback for better compatibility
- **Fixed Plex timeout issues** - Increased library timeout to handle large collections

### Data Persistence

- **Fixed streamingSources serialization** - Convert object to array and handle null API keys properly
- **Fixed config update logic** - Update `config.config` internal object instead of class itself
- **Fixed key change detection** - Use `originalToken` comparison to detect ACTUAL changes

---

## ✨ New Features & Enhancements

### Testing Infrastructure (Major Improvement)

- **Comprehensive test coverage improvements** - From ~60% to 92%+ across critical modules:
    - `jellyfin-http-client.js`: 70% → 99% (statements) / 49% → 81% (branches)
    - `deviceStore.js`: 36% → 82% (statements) / 28% → 68% (branches)
    - `validate.js`: 72% → 95% (statements) / 68% → 89% (branches)
    - `tmdb.js`: 76% → 87% (statements) / 57% → 72% (branches)
    - `jellyfin.js`: 66% → 99% (statements) / 57% → 86% (branches)
    - `logger.js`: 60% → 71% (branches)
- **Added 2400+ comprehensive tests** covering edge cases, error paths, and integration scenarios
- **Resolved 28 wsHub edge case test failures** and deviceStore test issues
- **Added XSS attack vector tests** for comprehensive security validation
- **Added config backup test coverage enhancements**

### Production Build System

- **Vite production build infrastructure** - Complete build pipeline with optimization
- **Auto-deployment system** - Automatically rebuilds frontend if outdated on production startup
- **Frontend build verification** - `calculateDirectoryHash` utility for build freshness detection

### Performance Optimization (Phase 1-3 Complete)

- **Tiered caching implementation** - Multi-level cache with memory/disk tiers and intelligent promotion/demotion
- **Request deduplication** - Prevents duplicate parallel requests for same resources
- **Parallel playlist source fetching** - Significantly faster media loading
- **HTTP client optimization** - Connection pooling and keepAlive for 20-30% performance gain
- **Memory profiling tooling** - Automated memory growth monitoring and alerts
- **Critical CSS inline** - Non-blocking render for improved FCP
- **Script defer optimizations** - Better First Contentful Paint (FCP) metrics
- **Lighthouse audit infrastructure** - Automated performance baseline tracking

### Configuration & Backup System

- **Age-based retention for config backups** - Automatic cleanup based on days old
- **RetentionDays UI** - Admin panel controls for backup retention policy
- **Label and note support** - Better backup organization and documentation
- **Backup file size display** - "Next run in" countdown and file sizes in UI
- **Retention tooltip improvements** - Better UX for understanding backup policies

### API & Documentation

- **Comprehensive API documentation** - 93% production readiness with OpenAPI/Swagger
- **API v1 endpoints** - Modern versioned API endpoints for devices and media
    - `/api/v1/devices/*` - Device management endpoints
    - `/api/v1/media/:key` - Media retrieval endpoint
- **RFC 8594 deprecation signaling** - Proper API lifecycle management
- **Enhanced Swagger/OpenAPI docs** - Code samples, examples, better theme
- **Multiple API doc renderers** - Scalar (default), ReDoc, Swagger UI options
- **Auto-detect server URL** - Dynamic server URL in API documentation
- **Cache clear API endpoint** - `/api/admin/cache/clear` for cache management
- **Metrics aggregation** - Percentiles and moving averages for performance monitoring

### Architecture & Code Quality

- **Modular route extraction** - Routes moved to `routes/` directory for better organization
- **WebSocket/SSE server extraction** - Moved to `lib/realtime-server.js`
- **Helper function extraction** - Common logic moved to `lib/` modules
- **HTTP client base class** - Shared base class for Plex/Jellyfin/RomM clients
- **Device route business logic extraction** - Moved to `lib/device-operations.js`
- **Comprehensive JSDoc documentation** - Added to core utilities
- **Centralized error context** - Enhanced error handling in source adapters
- **Centralized timeout configuration** - All timeouts in one place
- **Environment variable centralization** - Moved to `config/environment.js`

### Security & Reliability

- **SafeFileStore with atomic writes** - File locking with `proper-lockfile`, backup/recovery
- **Configuration validation at startup** - Ensures config.json is valid before startup
- **XSS sanitization improvements** - Comprehensive test coverage for DOMPurify
- **Eager DOMPurify initialization** - Ensures sanitization is always available
- **WebSocket message validation** - Proper validation with debug logging instead of silent catches
- **Memory leak prevention** - Fixed PlexSessionsPoller maxErrors leak
- **Security audit filtering** - Smart filtering of known false positives
- **Cache memory limits** - Prevents unbounded memory growth

### Monitoring & Observability

- **Cache hit ratio monitoring** - Detailed metrics on cache performance
- **Image proxy fallback tracking** - Metrics for fallback behavior
- **Metrics aggregation endpoint** - `/api/admin/metrics` with detailed statistics
- **Centralized debug utility** - Module for consistent debug logging
- **Enhanced error logging** - Standardized across entire codebase
- **User-Agent tracking** - Centralized builder for HTTP clients

### UI/UX Improvements

- **Progressive image loading** - Removed loader animations for cleaner experience
- **Dynamic Plex server name** - Shows actual server name in Cinema display mode
- **Better retention UI** - Improved layout and clarification of retention logic
- **Improved error messages** - More helpful validation and error feedback

---

## 🔧 Refactoring & Maintenance

### Code Organization

- **Scripts cleanup** - Removed 37 obsolete files (66% reduction)
- **Removed visual regression tools** - Streamlined testing approach
- **Removed artificial coverage tests** - Focus on real test value
- **Removed unused `__mocks__` directory** - Cleaner project structure
- **Moved `utils.js` to `utils/array-utils.js`** - Better organization

### Documentation

- **Comprehensive backend analysis** - Complete code review and documentation
- **Frontend analysis consolidation** - 14 analysis files into 2 comprehensive documents
- **Performance baseline documentation** - Lighthouse audits and benchmarks
- **Deployment guide** - Complete guide for dev/prod modes
- **Gitea migration** - Moved from GitHub Issues to Gitea workflow
- **API production readiness tracking** - Clear roadmap and status updates

### Dependency Management

- **Safe dependency updates** - Sprint 1 dependency refresh
- **Security vulnerability fixes** - Fixed js-yaml vulnerability
- **Downgraded jsdom** - Resolved parse5 ES module compatibility
- **Package.json accuracy** - Updated to match installed dependency versions

### Git & CI/CD

- **Pre-commit hooks** - Automatic formatting with Prettier and ESLint auto-fix
- **Pre-push quality checks** - Syntax validation, critical file checks, regression tests
- **Master test script** - Comprehensive release readiness validation (38 checks)
- **GitHub Actions improvements** - Simplified CI pipeline
- **Gitea Actions testing** - Evaluated self-hosted CI options

---

## 📊 Performance Metrics

### Test Coverage

- **Overall coverage:** 92%+ (up from ~60%)
- **2400+ tests** with comprehensive edge case coverage
- **All regression tests passing** - 0 blockers, 3 minor warnings

### API Production Readiness

- **93% complete** - Phase 0.2 finished
- **15/15 contract tests passing** - All API contracts validated
- **Comprehensive OpenAPI documentation** - With examples and code samples

### Build Optimization

- **Frontend build system** - Complete Vite pipeline with auto-deployment
- **Performance audits** - Lighthouse reports and automated monitoring
- **Memory profiling** - Automated growth detection and alerts

### Performance Improvements

- **20-30% faster HTTP requests** - Connection pooling and keepAlive
- **Parallel playlist fetching** - Significantly faster media loading
- **Tiered caching** - Reduced response times for cached content
- **Request deduplication** - Eliminated redundant parallel requests

---

## 🔄 Migration Notes

### Breaking Changes

None. This release maintains full backward compatibility with v2.9.4.

### Recommended Actions

1. **Run master test script** before deploying: `./scripts/master-test.sh`
2. **Review backup retention settings** in admin panel (new feature)
3. **Check cache hit ratios** via `/api/admin/metrics` endpoint
4. **Verify API documentation** at `/api-docs` reflects your setup

### Configuration Changes

- **New optional fields** in config.json for backup retention (retentionDays, retentionCount)
- **Environment variables** now centralized in `config/environment.js`
- All existing configurations remain compatible

---

## 🙏 Acknowledgments

This release represents months of focused work on production readiness, testing infrastructure, and code quality. Special thanks to the community for bug reports and feedback that helped prioritize these improvements.

---

## 📝 Full Changelog

For a complete list of all 200+ commits, see the [comparison view on GitHub](https://github.com/Posterrama/posterrama/compare/v2.9.4...v2.9.5).

### Commit Statistics

- **Total commits:** 200+
- **Files changed:** 500+
- **Lines added:** 50,000+
- **Lines removed:** 20,000+
- **Test coverage increase:** +32 percentage points
- **Bug fixes:** 30+
- **New features:** 40+
- **Refactoring improvements:** 50+

---

## 🚀 Getting Started

### Installation

```bash
git clone https://github.com/Posterrama/posterrama.git
cd posterrama
npm install
cp config.example.json config.json
# Edit config.json with your settings
npm start
```

### Upgrade from 2.9.4

```bash
git pull origin main
npm install
npm run release:ready  # Verify everything works
pm2 restart posterrama
```

### Docker

```bash
docker pull posterrama/posterrama:2.9.5
# Or use docker-compose with the latest image
```

---

## 📚 Resources

- **Documentation:** [README.md](README.md)
- **API Docs:** http://your-server:4000/api-docs
- **Issues:** https://github.com/Posterrama/posterrama/issues
- **Discussions:** https://github.com/Posterrama/posterrama/discussions

---

**Enjoy Posterrama v2.9.5!** 🎬✨
