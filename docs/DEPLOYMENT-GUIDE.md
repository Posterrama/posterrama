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

- Serves static files from `public/`
- Live file changes without rebuild
- More developer-friendly logging/error output (recommended for local work)

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

- Serves static files from `public/`
- Reduced logging verbosity (recommended)
- Optimized for stable long-running operation (PM2)

**Use When:**

- Production deployments
- Staging environments
- Performance testing
- Public-facing servers

---

## Deployment Workflows

### Scenario 1: Local Development → Production Server

**Developer Machine (Development):**

```bash
# 1. Set development mode in .env
# (edit the file; avoid duplicate NODE_ENV lines)
nano .env

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

# 3. Restart server
pm2 delete posterrama && pm2 start ecosystem.config.js
```

### Scenario 2: Using Deployment Script

**Automated deployment helper:**

```bash
# Production server only
./scripts/deploy-production.sh
```

This script:

1. Stops and deletes the PM2 process (if running)
2. Starts Posterrama via `ecosystem.config.js` (which loads `.env`)
3. Saves PM2 configuration

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

- `public/` (served as-is)
- `server.js`
- `ecosystem.config.js` (PM2 config)
- `config.example.env` (template)
- `.env` (secrets, in `.gitignore`)

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

## Troubleshooting

### Server Serves Wrong Directory

**Check current mode:**

```bash
pm2 logs posterrama --lines 5 | grep "Static files"
# Should show:
# [Server] Static files served from: /var/www/posterrama/public
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
- Serves from `public/`

    **Workflow:**

1. Develop locally with `NODE_ENV=development`
2. Commit and push changes
3. Production server pulls and restarts
4. Assets are served directly from `public/`

No frontend build step is required.

---

**Last updated:** December 14, 2025
**Version:** 2.9.9
