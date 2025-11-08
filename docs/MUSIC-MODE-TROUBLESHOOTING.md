# Music Mode Troubleshooting Guide

This guide helps resolve common issues with Posterrama's Music Mode feature.

## Table of Contents

- [No Albums Appearing](#no-albums-appearing)
- [Album Covers Stretched or Distorted](#album-covers-stretched-or-distorted)
- [Missing Metadata Overlays](#missing-metadata-overlays)
- [Plex Connection Errors](#plex-connection-errors)
- [Empty Genre/Artist Lists](#empty-genreartist-lists)
- [Performance Issues](#performance-issues)
- [Filter Not Working](#filter-not-working)
- [Music Mode Not Activating](#music-mode-not-activating)

---

## No Albums Appearing

**Symptoms:**

- Wallart display is blank or shows movies instead of albums
- `/get-media?musicMode=1` returns empty array

**Possible Causes & Solutions:**

### 1. Music Mode Not Enabled

```bash
# Check config.json
cat config.json | grep -A 5 "musicMode"
```

Ensure `enabled: true`:

```json
{
    "wallartMode": {
        "musicMode": {
            "enabled": true
        }
    }
}
```

### 2. No Plex Server Configured

- Navigate to admin UI → Media Servers
- Verify Plex server is enabled
- Test connection with "Test Connection" button
- Ensure Plex token is valid

### 3. No Music Libraries Selected

- In admin UI → Music Mode card
- Click "Refresh Libraries" button
- Select at least one music library from dropdown
- Save configuration

### 4. Empty Music Library

- Verify your Plex music library has albums with artwork
- Check Plex web interface to confirm albums are visible
- Run Plex library scan if recently added music

### 5. Network Issues

```bash
# Test Plex connectivity
curl -H "X-Plex-Token: YOUR_TOKEN" http://localhost:32400/library/sections
```

If this fails, check:

- Plex server is running
- Firewall allows connections
- Correct server URL in config

---

## Album Covers Stretched or Distorted

**Symptoms:**

- Album covers appear stretched vertically (portrait ratio)
- Square album art looks wrong

**Possible Causes & Solutions:**

### 1. Response Missing `type: "music"`

Check API response:

```bash
curl http://localhost:4000/get-media?musicMode=1&count=5 | jq '.[0].type'
```

Should return `"music"`. If not:

- Update Plex source to latest version
- Verify `PlexSource.fetchMusic()` sets type correctly
- Check `sources/plex.js` line ~650

### 2. CSS Override

- Check browser dev tools (F12) → Elements
- Look for conflicting CSS on `.wallart-poster-item img`
- Should have `object-fit: cover` for music items

### 3. Browser Caching

```bash
# Clear browser cache
Ctrl+Shift+Delete (Windows/Linux)
Cmd+Shift+Delete (macOS)
```

Then hard refresh: `Ctrl+F5` or `Cmd+Shift+R`

---

## Missing Metadata Overlays

**Symptoms:**

- Album covers show but no artist/album/year/genre info
- Gradient overlay at bottom is missing

**Possible Causes & Solutions:**

### 1. All Visibility Options Disabled

- Admin UI → Music Mode → Visibility section
- Enable at least one option:
    - ☑ Show Artist Name
    - ☑ Show Album Title
    - ☑ Show Release Year
    - ☑ Show Genre
- Save configuration

### 2. Missing Metadata in Source

Check API response:

```bash
curl http://localhost:4000/get-media?musicMode=1&count=1 | jq '.[0]'
```

If fields are missing:

- Update album metadata in Plex
- Re-scan library with "Analyze" option
- Verify Plex agents are configured correctly

### 3. JavaScript Error

- Open browser console (F12)
- Look for errors related to `music-metadata-overlay`
- Check `wallart-display.js` overlay creation logic

---

## Plex Connection Errors

**Symptoms:**

- Error: "Failed to connect to Plex server"
- 401 Unauthorized responses
- Timeout errors

**Solutions:**

### 1. Invalid Token

Get new token:

1. Log into Plex web interface
2. Play any media item
3. Click "..." → "Get Info"
4. View XML
5. Copy token from URL: `X-Plex-Token=...`

### 2. Wrong Server URL

```bash
# Test different URL formats
http://localhost:32400       # Local
http://192.168.1.100:32400   # LAN IP
https://plex.example.com:32400  # Remote
```

### 3. Firewall Blocking

```bash
# Check if port is accessible
telnet localhost 32400
# or
nc -zv localhost 32400
```

### 4. SSL Certificate Issues

For HTTPS connections:

- Ensure valid SSL certificate
- Try HTTP instead for testing
- Check Plex "Secure connections" setting

---

## Empty Genre/Artist Lists

**Symptoms:**

- "Load Genres" button shows no results
- "Load Artists" button shows no results

**Solutions:**

### 1. Library Not Selected

- Select music library first from dropdown
- Then click "Load Genres" or "Load Artists"

### 2. API Endpoint Error

Test endpoints:

```bash
# Get music libraries
curl http://localhost:4000/api/admin/plex/music-libraries

# Get genres (replace 1 with your library key)
curl http://localhost:4000/api/admin/plex/music-genres?libraryKey=1

# Get artists
curl http://localhost:4000/api/admin/plex/music-artists?libraryKey=1&limit=50
```

### 3. Plex Library Scanning

- Plex may still be scanning library
- Wait for scan to complete
- Check Plex dashboard for scan status

### 4. No Metadata

- Albums lack genre/artist metadata
- Update metadata in Plex
- Use Plex's "Fix Match" feature for better metadata

---

## Performance Issues

**Symptoms:**

- Wallart display is slow or laggy
- High memory usage
- Browser freezing

**Solutions:**

### 1. Reduce Album Count

```json
{
    "wallartMode": {
        "musicMode": {
            "maxAlbums": 100 // Reduce from default 500
        }
    }
}
```

Or use URL parameter: `?count=50`

### 2. Reduce Grid Size

- Admin UI → Music Mode → Grid Size
- Change from 5×5 to 3×3 or 2×2
- Fewer visible items = better performance

### 3. Disable Animations

- Set animation type to "none"
- Reduces CPU/GPU usage

### 4. Optimize Images

- Use Plex image transcoding
- Ensure album art is reasonably sized (<2MB)
- Consider using Plex thumbnail URLs

### 5. Browser Performance

```bash
# Chrome flags for better performance
chrome --enable-gpu-rasterization
chrome --enable-zero-copy
```

---

## Filter Not Working

**Symptoms:**

- Albums appear that don't match selected genres
- Artists filter seems ignored
- Rating filter not applied

**Solutions:**

### 1. Verify Filter Configuration

```bash
# Check config
cat config.json | jq '.mediaServers[0].musicFilters'
```

Should show:

```json
{
    "genres": ["Rock", "Jazz"],
    "artists": ["The Beatles"],
    "minRating": 7.0
}
```

### 2. Filter Logic Check

- Filters are OR within categories, AND between categories
- Example: (Rock OR Jazz) AND (rating >= 7.0)
- Empty filter = no filtering applied

### 3. Plex Metadata Issues

- Album genre must match exactly (case-sensitive)
- Check album metadata in Plex
- Use Plex's genre normalization

### 4. Rating Scale Mismatch

- Plex uses 0-10 scale
- Config also uses 0-10 scale
- Ensure `minRating` is within range

---

## Music Mode Not Activating

**Symptoms:**

- Wallart shows movies even with music mode enabled
- `/get-media?musicMode=1` returns movies

**Solutions:**

### 1. Query Parameter Missing

- Verify URL includes `?musicMode=1`
- Check browser network tab (F12)
- Look for GET request to `/get-media`

### 2. Config Not Saved

```bash
# Check when config was last modified
ls -la config.json
```

- Ensure you clicked "Save Configuration" in admin
- Check for permission errors in logs

### 3. Mutual Exclusivity Conflict

- Music Mode and Games Only Mode are mutually exclusive
- Disable Games Only if both are enabled
- Check config:

```json
{
    "wallartMode": {
        "gamesOnly": false, // Must be false
        "musicMode": {
            "enabled": true
        }
    }
}
```

### 4. Backend Route Logic

Check logs:

```bash
tail -f logs/combined.log | grep -i music
```

Should see:

- "Music mode enabled, fetching music albums"
- Album count in response

If you see:

- "Music mode disabled, using regular media"
- Config not loaded correctly

---

## Advanced Debugging

### Enable Debug Logging

Add to config.json:

```json
{
    "logLevel": "debug"
}
```

Restart server:

```bash
pm2 restart posterrama
```

### Browser Console Debugging

```javascript
// Check config loaded
console.log(window.appConfig?.wallartMode?.musicMode);

// Check mediaQueue content
console.log(window.mediaQueue?.filter(m => m.type === 'music'));

// Manual API test
fetch('/get-media?musicMode=1&count=10')
    .then(r => r.json())
    .then(d => console.log('Music albums:', d));
```

### Network Analysis

```bash
# Monitor all requests
tcpdump -i any -A 'port 4000'

# Check response times
curl -w "@curl-format.txt" -o /dev/null -s http://localhost:4000/get-media?musicMode=1
```

curl-format.txt:

```
time_total: %{time_total}\n
time_connect: %{time_connect}\n
```

---

## Getting Help

If these solutions don't resolve your issue:

1. **Check existing issues**: https://github.com/Posterrama/posterrama/issues
2. **Create new issue** with:
    - Posterrama version (`cat package.json | grep version`)
    - Node.js version (`node --version`)
    - Plex version
    - Browser and OS
    - Relevant config.json sections (redact tokens!)
    - Console errors from browser (F12)
    - Server logs (`tail -100 logs/combined.log`)
    - API response: `curl http://localhost:4000/get-media?musicMode=1&count=5 | jq`

3. **Test environment**:
    - Does it work with default config?
    - Does it work with a different music library?
    - Does it work on a different browser?

---

## Quick Reference

| Issue            | Quick Fix                                      |
| ---------------- | ---------------------------------------------- |
| No albums        | Enable music mode, select library, save config |
| Stretched covers | Verify `type: "music"` in API response         |
| No overlays      | Enable visibility options in admin UI          |
| Connection error | Check Plex token and server URL                |
| Empty lists      | Select library before loading genres/artists   |
| Slow performance | Reduce grid size or album count                |
| Filter ignored   | Verify filter in config.json musicFilters      |
| Not activating   | Check `?musicMode=1` query parameter           |

## See Also

- [Music Mode Testing Guide](./MUSIC-MODE-TESTING.md) - Complete testing checklist
- [Development Guide](./DEVELOPMENT.md) - For developers working on music mode
- [API Documentation](http://localhost:4000/api-docs) - API endpoint reference
