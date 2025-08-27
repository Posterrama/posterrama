# Jellyfin Test and Debug Scripts

This directory contains various test and debug scripts that were used during the development of the Jellyfin integration for Posterrama. These scripts are primarily for development and debugging purposes.

## Scripts Overview

### Manual Testing Scripts

- `test-jellyfin-manual.js` - Manual connection testing using environment variables
- `test-jellyfin-integration.mjs` - Integration testing for Jellyfin server connection
- `test-jellyfin-comprehensive.mjs` - Comprehensive testing of all Jellyfin functionality

### Feature-Specific Tests

- `test-jellyfin-admin-ui.mjs` - Tests for admin UI Jellyfin integration
- `test-jellyfin-posters.mjs` - Testing poster/image fetching from Jellyfin
- `test-jellyfin-genres-debug.mjs` - Debug script for genre fetching issues
- `test-admin-genre-api.mjs` - API endpoint testing for genre functionality

### Development and Debug Scripts

- `debug-jellyfin-genres.mjs` - Debug helper for genre-related issues
- `test-jellyfin-error-fix.mjs` - Error handling testing
- `test-jellyfin-improvements.mjs` - Testing improvements and optimizations
- `test-jellyfin-no-sdk.mjs` - Direct HTTP client testing (no SDK)
- `test-error-resilience.mjs` - Error resilience testing

## Usage

Most scripts can be run directly from this directory:

```bash
# From the project root
node scripts/jellyfin-tests/test-jellyfin-manual.js

# Or for ES modules
node scripts/jellyfin-tests/test-jellyfin-integration.mjs
```

**Note:** These scripts require proper environment variables to be set (JELLYFIN_HOSTNAME, JELLYFIN_PORT, JELLYFIN_API_KEY) and are primarily intended for development use.

## Status

These scripts were created during the development phase and may not be maintained for production use. They serve as reference implementations and debugging tools.
