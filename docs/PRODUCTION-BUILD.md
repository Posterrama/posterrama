# Production Build Guide

## Overview

Posterrama v2.9.4 includes a production build system that automatically removes `console.log()`, `console.debug()`, and `console.info()` statements from frontend JavaScript code. This ensures no debug logging reaches production while maintaining `console.warn()` and `console.error()` for critical messages.

## Quick Start

### Build for Production

```bash
npm run build:prod
```

This creates a production-ready copy of the `public/` directory in `dist/public/` with all console statements removed.

### Test Production Build

```bash
npm run build:prod:test
```

Builds and immediately starts the server with the production build to verify functionality.

## What Gets Removed

**Frontend Code (public/):**

- ✅ `console.log()` - Removed (172 instances in v2.9.4)
- ✅ `console.debug()` - Removed
- ✅ `console.info()` - Removed
- ❌ `console.warn()` - **Kept** (important warnings)
- ❌ `console.error()` - **Kept** (critical errors)

**Backend Code (server.js, lib/, routes/, etc.):**

- Console logs are **conditionally executed** based on `process.env.CI` or `process.env.DEBUG_TESTS`
- No production removal needed - already safe

**Exceptions:**

- `public/client-logger.js` - Skipped (logger infrastructure needs console access)

## Build Output

```
==========================================
Posterrama Production Build v2.9.4
==========================================

Step 1/4: Cleaning dist directory...
✓ Dist directory cleaned

Step 2/4: Copying public files to dist...
✓ Files copied

Step 3/4: Removing console.logs from JavaScript...
  ✓ Processed: dist/public/admin.js (removed 94 console statements)
  ✓ Processed: dist/public/device-mgmt.js (removed 38 console statements)
  ✓ Processed: dist/public/wallart/artist-cards.js (removed 15 console statements)
  ...
  ⊘ Skipped: dist/public/client-logger.js (logger infrastructure)

✓ Processed 25 JavaScript files
✓ Removed 172 console statements

Step 4/4: Verifying console.logs removed...
✓ All console.logs successfully removed

==========================================
Production Build Complete!
==========================================

Output directory: dist/public
Backup directory: dist/backup
```

## Development Workflow

### During Development

Console.log statements are **allowed and encouraged** during development:

```javascript
// ✅ OK during development
console.log('Debug info:', data);
console.debug('Detailed state:', state);
```

ESLint will show **warnings** (not errors) for console statements, reminding you they'll be removed in production.

### Before Deployment

1. **Run production build:**

    ```bash
    npm run build:prod
    ```

2. **Verify build works:**

    ```bash
    npm run build:prod:test
    ```

3. **Deploy dist/public:**
    ```bash
    rsync -av dist/public/ user@server:/path/to/posterrama/public/
    ```

## Alternative: Use Logger Infrastructure

For persistent logging that respects debug mode, use the existing `window.logger`:

```javascript
// Automatically respects debug mode
window.logger.debug('Debug info:', data); // Only when debug enabled
window.logger.info('Info message:', info); // Only when debug enabled
window.logger.warn('Warning:', warning); // Always shown
window.logger.error('Error:', error); // Always shown
```

Debug mode is enabled when:

- `localStorage.posterrama_debug = 'true'`
- `defaults.DEBUG = true` (from config)
- URL parameter `?debug=true`

## Technical Details

### Build Script

Location: `scripts/build-production.sh`

**Process:**

1. Clean `dist/` directory
2. Copy `public/` → `dist/public/`
3. Find all `.js` files (excluding `.min.js`, `node_modules/`)
4. Use Node.js regex replacement to remove console statements
5. Verify removal with grep

**Backup:**
Original files backed up to `dist/backup/` before modification.

### ESLint Configuration

```javascript
// .eslintrc.js
rules: {
  'no-console': ['warn', { allow: ['warn', 'error'] }]
}
```

This warns about `console.log/debug/info` but allows `console.warn/error`.

### NPM Scripts

```json
{
    "scripts": {
        "build:prod": "./scripts/build-production.sh",
        "build:prod:test": "npm run build:prod && node server.js --public-dir=dist/public"
    }
}
```

## CI/CD Integration

### GitHub Actions Example

```yaml
- name: Build for production
  run: npm run build:prod

- name: Verify console.logs removed
  run: |
      REMAINING=$(grep -r "console\.log(" dist/public --include="*.js" | wc -l)
      if [ "$REMAINING" -ne 0 ]; then
        echo "ERROR: Found $REMAINING console.logs in production build"
        exit 1
      fi

- name: Deploy
  run: rsync -av dist/public/ ${{ secrets.DEPLOY_TARGET }}
```

### Docker Integration

```dockerfile
# Dockerfile
COPY . /app
WORKDIR /app

RUN npm ci
RUN npm run build:prod

# Use production build
CMD ["node", "server.js", "--public-dir=dist/public"]
```

## Troubleshooting

### Console.logs still appearing in browser

**Cause:** Using `public/` directory instead of `dist/public/`

**Solution:**

```bash
# Rebuild
npm run build:prod

# Start with production build
node server.js --public-dir=dist/public
```

### ESLint errors blocking commit

**Cause:** ESLint set to `error` instead of `warn`

**Solution:**

```bash
# Temporarily disable
npm run lint -- --max-warnings=999

# Or fix with automated build
npm run build:prod
```

### Some console.logs not removed

**Cause:** Complex multi-line patterns or escaped characters

**Solution:**

1. Check `dist/backup/` for originals
2. Manually review the file
3. Simplify console.log patterns:

    ```javascript
    // ❌ Hard to remove automatically
    console.log('Complex ' + 'multi-line ' + data);

    // ✅ Easy to remove
    console.log('Simple:', data);
    ```

## Best Practices

### ✅ DO

- Use `console.log()` freely during development
- Run `npm run build:prod` before deployment
- Use `window.logger` for persistent debug infrastructure
- Keep `console.warn()` and `console.error()` for important messages

### ❌ DON'T

- Deploy `public/` directory directly to production
- Remove ESLint warnings manually (they're helpful reminders)
- Use complex multi-line console.log patterns
- Log sensitive data (passwords, tokens) even in development

## Related Documentation

- [DEPLOYMENT-GUIDE.md](./DEPLOYMENT-GUIDE.md) - Full deployment instructions
- [FRONTEND-ARCHITECTURE.md](./FRONTEND-ARCHITECTURE.md) - Client-side architecture
- [API-PRODUCTION-READINESS.md](./API-PRODUCTION-READINESS.md) - Backend production readiness

## Version History

- **v2.9.4** - Initial production build system
    - Removes 172 console statements from frontend
    - ESLint warnings for console usage
    - Automated build script with verification
