# Deployment Guide

## Development vs Production Modes

Posterrama supports two runtime modes controlled by `NODE_ENV` in your `.env` file:

### Development Mode (Default for Local Development)

**Configuration:**

```bash
# .env
NODE_ENV=development
```

**Behavior:**

- Serves raw files from `public/` (no build step)
- Live file changes without rebuild
- Full error stack traces in browser
- Verbose logging enabled
- No minification (larger files)
- No cache-busting hashes

**Use When:**

- Local development
- Debugging frontend issues
- Quick iterations on HTML/CSS/JS
- Testing without build overhead

### Production Mode (Default for Servers)

**Configuration:**

```bash
# .env
NODE_ENV=production
```

**Behavior:**

- Auto-builds frontend on startup if changed
- Serves minified files from `dist/public/`
- CSS minification (~29% smaller)
- Asset hashing for cache busting
- Smart rebuild detection (hash-based)
- Reduced logging verbosity
- Requires rebuild for frontend changes

**Use When:**

- Production deployments
- Staging environments
- Performance testing
- Public-facing servers

---

## Automatic Build System

In **production mode**, the server automatically builds the frontend on startup if:

1. `dist/public/` doesn't exist
2. `dist/.build-hash` is missing
3. Files in `public/` changed (hash mismatch)

**Build Process:**

```
[Server] public/ directory changed, rebuilding frontend...
[Server] Running npm run build...
vite build (minifies CSS, bundles ES modules)
[Server] Frontend build completed successfully
[Server] Static files served from: /var/www/posterrama/dist/public
```

**Skips Build When:**

```
[Server] dist/public/ is up-to-date, skipping build
[Server] Static files served from: /var/www/posterrama/dist/public
```

---

## Deployment Workflows

### Scenario 1: Local Development → Production Server

**Developer Machine (Development):**

```bash
# 1. Set development mode in .env
echo "NODE_ENV=development" >> .env

# 2. Start server (serves from public/)
pm2 delete posterrama && pm2 start ecosystem.config.js

# 3. Make changes to public/ files
# Changes are immediately visible (no build needed)

# 4. Commit and push changes
git add -A
git commit -m "feat: Add new feature"
git push origin main
```

**Production Server (Production):**

```bash
# 1. Ensure production mode in .env
grep NODE_ENV .env
# Should show: NODE_ENV=production

# 2. Pull latest changes
git pull origin main

# 3. Restart server (auto-builds if changed)
pm2 delete posterrama && pm2 start ecosystem.config.js
# [Server] public/ directory changed, rebuilding frontend...
# [Server] Frontend build completed successfully
```

### Scenario 2: Using Deployment Script

**Automated deployment with build script:**

```bash
# Production server only
./scripts/deploy-production.sh
```

This script:

1. Runs `npm run build` (creates `dist/public/`)
2. Stops PM2 process
3. Deletes old PM2 process
4. Starts fresh with `ecosystem.config.js`
5. Saves PM2 configuration
6. Shows build size and useful commands

### Scenario 3: CI/CD Pipeline

**Example GitHub Actions workflow:**

```yaml
name: Deploy to Production

on:
 push:
 branches: [main]

jobs:
 deploy:
 runs-on: ubuntu-latest
 steps:
 - uses: actions/checkout@v3

 - name: Deploy to server
 run: |
 ssh user@server << 'EOF'
 cd /var/www/posterrama
 git pull origin main

 # Ensure production mode
 grep -q "NODE_ENV=production" .env || echo "NODE_ENV=production" >> .env

 # Auto-build happens on restart
 pm2 delete posterrama
 pm2 start ecosystem.config.js
 pm2 save
 EOF
```

### Scenario 4: Manual Update (Fallback)

**If automatic updates fail or for troubleshooting:**

```bash
# Run manual update script
sudo bash scripts/manual-update.sh [version]
```

This script:

1. Downloads the specified version (or latest)
2. Backs up configuration (`config.json`, `devices.json`, `.env`)
3. Replaces code while preserving data
4. Restores configuration
5. Restalls dependencies and restarts PM2

---

## Configuration Best Practices

### 1. `.env` File Management

**Development `.env`:**

```bash
NODE_ENV=development
DEBUG=true
SERVER_PORT=4000
PLEX_TOKEN=your_token_here
```

**Production `.env` (on server):**

```bash
NODE_ENV=production
DEBUG=false
SERVER_PORT=4000
PLEX_TOKEN=your_token_here
```

**Important:** `.env` is gitignored! Each environment has its own `.env`.

### 2. Version Control Strategy

**Commit to Git:**

- `public/` (source files)
- `vite.config.js` (build configuration)
- `ecosystem.config.js` (PM2 config)
- `config.example.env` (template)
- `dist/` (generated files, in `.gitignore`)
- `.env` (secrets, in `.gitignore`)
- `dist/.build-hash` (runtime cache)

### 3. Multiple Developers

**Shared Development:**

```bash
# Each developer runs their own .env with NODE_ENV=development
# No build conflicts, immediate file changes

# Developer A
cd /var/www/posterrama
echo "NODE_ENV=development" > .env
pm2 start ecosystem.config.js

# Developer B (different machine)
cd /var/www/posterrama
echo "NODE_ENV=development" > .env
pm2 start ecosystem.config.js
```

---

## Build Performance

**Hash Calculation:**

- ~50ms for typical `public/` directory
- SHA256 hash of all files + modification times
- Only runs in production mode

**Build Times:**

- Initial build: ~5-10 seconds
- Skipped (up-to-date): ~50ms (hash check only)
- CSS minification: 460KB → 326KB (29% reduction)
- ES modules: Bundled with cache-busting hashes

**Build Output:**

```
dist/public/
├── admin.html (253 KB, gzipped: 38 KB)
├── assets/
│ ├── admin.B1PlrUXO.css (326 KB, gzipped: 42 KB)
│ ├── error-handler.l-FyDqMs.js (1.15 KB, gzipped: 0.62 KB)
│ ├── mode-redirect.CnJlCTyG.js (2.17 KB, gzipped: 0.95 KB)
│ └── screensaver.BOeF07Qd.js (2.30 KB, gzipped: 0.96 KB)
└── ... (other pages)

Total: 1.8 MB (vs public/ 3.6 MB)
```

---

## Troubleshooting

### Build Fails on Server Startup

**Symptom:**

```
[Server] Frontend build failed: Command failed: npm run build
[Server] Falling back to public/ directory
```

**Solutions:**

1. Check Node.js version: `node --version` (requires >= 18.0.0)
2. Reinstall dependencies: `npm install`
3. Clear old build: `rm -rf dist/`
4. Manual build test: `npm run build`

### Server Serves Wrong Directory

**Check current mode:**

```bash
pm2 logs posterrama --lines 5 | grep "Static files"
# Should show either:
# [Server] Static files served from: /var/www/posterrama/dist/public (NODE_ENV=production)
# [Server] Static files served from: /var/www/posterrama/public (NODE_ENV=development)
```

**Verify NODE_ENV:**

```bash
pm2 env 0 | grep NODE_ENV
# Should show: NODE_ENV: production (or development)
```

**Fix wrong mode:**

```bash
# Edit .env
nano .env
# Set: NODE_ENV=production (or development)

# Force reload .env
pm2 delete posterrama
pm2 start ecosystem.config.js
```

### Build Not Detecting Changes

**Force rebuild:**

```bash
# Delete build hash
rm -f /var/www/posterrama/dist/.build-hash

# Restart server (will rebuild)
pm2 restart posterrama
```

**Check hash:**

```bash
cat /var/www/posterrama/dist/.build-hash
# Shows 64-character SHA256 hash
```

### Development Mode Changes Not Visible

**Symptoms:**

- Edit `public/admin.html`
- Refresh browser
- No changes visible

**Solutions:**

1. Check you're in development mode:

```bash
pm2 logs posterrama --lines 5 | grep NODE_ENV
# Should show: NODE_ENV=development
```

2. Clear browser cache (Ctrl+Shift+R)

3. Check file was saved:

```bash
ls -lh public/admin.html
# Verify timestamp is recent
```

---

## Quick Reference

| Task                  | Command                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| Check current mode    | `pm2 logs posterrama \| grep "Static files"`                                                    |
| Switch to development | Edit `.env` → `NODE_ENV=development` → `pm2 delete posterrama && pm2 start ecosystem.config.js` |
| Switch to production  | Edit `.env` → `NODE_ENV=production` → `pm2 delete posterrama && pm2 start ecosystem.config.js`  |
| Force rebuild         | `rm -f dist/.build-hash && pm2 restart posterrama`                                              |
| Manual build          | `npm run build`                                                                                 |
| Check build size      | `du -sh dist/public/`                                                                           |
| Deploy to production  | `./scripts/deploy-production.sh`                                                                |
| View server logs      | `pm2 logs posterrama`                                                                           |
| Check PM2 env vars    | `pm2 env 0`                                                                                     |

---

## Summary

**Development:**

- Set `NODE_ENV=development` in `.env`
- Serves from `public/` (no build)
- Instant file changes

    **Production:**

- Set `NODE_ENV=production` in `.env`
- Auto-builds on startup if changed
- Serves minified from `dist/public/`

    **Workflow:**

1. Develop locally with `NODE_ENV=development`
2. Commit and push changes
3. Production server pulls and restarts
4. Auto-build detects changes and rebuilds
5. Minified assets served to users

No manual build steps needed on either side!

---

**Last updated:** November 16, 2025
**Version:** 2.9.8
