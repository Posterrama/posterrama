# PM2 Environment Variable Management

## Problem: PM2 Environment Cache Issue

### What was happening:

- PM2 caches environment variables when an application starts
- When `.env` files are updated, PM2 continues using old cached values
- `pm2 restart` doesn't automatically reload environment variables
- This caused Jellyfin to use an old API key despite `.env` having the correct one

### Root Cause:

1. **PM2 Environment Caching**: PM2 stores env vars in memory when app starts
2. **Static .env Loading**: `ecosystem.config.js` loaded `.env` only once
3. **Missing --update-env**: Regular `pm2 restart` doesn't refresh environment

## Permanent Solution Implemented

### 1. Force Environment Reload on Startup

**File: `server.js`**

- Added `forceReloadEnv()` function that reads `.env` directly on every startup
- Overrides `process.env` with latest values from `.env` file
- Logs when critical API keys are updated from PM2 cache
- Prevents PM2 cache issues completely

### 2. Dynamic Environment Loading

**File: `ecosystem.config.js`**

- Changed from cached `envVars` to dynamic `loadEnvFile()` call
- Ensures fresh `.env` values on every PM2 operation
- Added restart_delay for stability

### 3. Helper Script for Reliable Restarts

**File: `scripts/restart-with-env.sh`**

```bash
# Use this for guaranteed fresh environment
./scripts/restart-with-env.sh
```

### 4. Fallback Environment Reading

**Multiple locations in code:**

- All Jellyfin functions now read directly from `.env` as fallback
- If `process.env.JELLYFIN_API_KEY` is empty, reads from `.env` file
- Updates `process.env` for consistency

## How to Handle Environment Changes

### Option 1: Regular Restart (now safe)

```bash
pm2 restart posterrama
```

_Now works reliably due to force reload mechanism_

### Option 2: Full Reset (most reliable)

```bash
./scripts/restart-with-env.sh
```

### Option 3: Manual Override (for emergencies)

```bash
pm2 restart posterrama --update-env
```

## Monitoring Environment Loading

### Check Current Environment:

```bash
pm2 env 0 | grep JELLYFIN_API_KEY
```

### Monitor Startup Logs:

```bash
pm2 logs posterrama --lines 20 | grep "Startup.*Updated"
```

### Verify .env File:

```bash
cat .env | grep JELLYFIN_API_KEY
```

## Prevention Checklist

✅ **Force environment reload on startup** (implemented)
✅ **Dynamic .env loading in ecosystem.config.js** (implemented)  
✅ **Fallback .env reading in all Jellyfin functions** (implemented)
✅ **Helper script for reliable restarts** (implemented)
✅ **Monitoring and logging** (implemented)

## Best Practices Going Forward

1. **After updating .env**: Use `./scripts/restart-with-env.sh`
2. **Regular restarts**: `pm2 restart posterrama` now works safely
3. **Monitor startup logs**: Check for "Updated X from PM2 cache" messages
4. **Verify environment**: Use `pm2 env 0` to confirm correct values loaded

### Admin UI cache refresh

- The Admin UI (`/admin`) loads `admin.js` and `admin.css` with server-side cache-busting and a Service Worker network-first strategy.
- A regular restart is sufficient to pick up UI changes; clients typically receive the latest assets on next load.

This solution ensures that `.env` values are **always** used, regardless of PM2's internal caching behavior.
