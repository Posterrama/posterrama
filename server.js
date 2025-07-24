/**
 * posterrama.app - Server-side logic for multiple media sources
 *
 * Author: Mark Frelink
 * Version: 1.1.0
 * Last Modified: 2024-08-02
 * License: AGPL-3.0-or-later - This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

require('dotenv').config();
const express = require('express');
const PlexAPI = require('plex-api');
const fetch = require('node-fetch');
const config = require('./config.json');
const { shuffleArray } = require('./utils.js');

const app = express();

// Use process.env with a fallback to config.json
const port = process.env.SERVER_PORT || config.serverPort || 4000;
const isDebug = process.env.DEBUG === 'true';

if (isDebug) console.log('--- DEBUG MODE IS ACTIVE ---');

app.use(express.static('public'));

async function processPlexItem(itemSummary, serverConfig) {
    const plex = getPlexClient(serverConfig);
    try {
        if (!itemSummary.key) return null;
        const detailResponse = await plex.query(itemSummary.key);
        const item = detailResponse?.MediaContainer?.Metadata?.[0];
        if (!item) return null;

        let sourceItem = item;
        let backgroundArt = item.art;
        if ((item.type === 'season' || item.type === 'episode') && item.parentKey) {
            try {
                const parentResponse = await plex.query(item.parentKey);
                if (parentResponse?.MediaContainer?.Metadata?.[0]) {
                    sourceItem = parentResponse.MediaContainer.Metadata[0];
                }
            } catch (e) {
                if (isDebug) console.log(`[Debug] Could not fetch series info for item ${item.title}`);
            }
        }
        if (!backgroundArt || !sourceItem.thumb) return null;

        let imdbUrl = null;
        if (sourceItem.Guid && Array.isArray(sourceItem.Guid)) {
            const imdbGuid = sourceItem.Guid.find(guid => guid.id.startsWith('imdb://'));
            if (imdbGuid) {
                const imdbId = imdbGuid.id.replace('imdb://', '');
                imdbUrl = `https://www.imdb.com/title/${imdbId}/`;
            }
        }

        let clearLogoPath = null;
        if (sourceItem.Image && Array.isArray(sourceItem.Image)) {
            const logoObject = sourceItem.Image.find(img => img.type === 'clearLogo');
            if (logoObject) clearLogoPath = logoObject.url;
        }
        
        const uniqueKey = `${serverConfig.type}-${serverConfig.name}-${sourceItem.ratingKey}`;
        return {
            key: uniqueKey,
            title: sourceItem.title,
            backgroundUrl: `/image?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(backgroundArt)}`,
            posterUrl: `/image?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(sourceItem.thumb)}`,
            clearLogoUrl: clearLogoPath ? `/image?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(clearLogoPath)}` : null,
            tagline: sourceItem.tagline,
            rating: sourceItem.rating,
            year: sourceItem.year,
            imdbUrl: imdbUrl,
            _raw: isDebug ? item : undefined
        };
    } catch (e) {
        if (isDebug) console.log(`[Debug] Skipping item due to error fetching details for key ${itemSummary.key}: ${e.message}`);
        return null;
    }
}

const plexClients = {};
function getPlexClient(serverConfig) {
    if (!plexClients[serverConfig.name]) {
        const token = process.env[serverConfig.tokenEnvVar];
        if (!token) {
            console.error(`[${serverConfig.name}] FATAL: Token environment variable "${serverConfig.tokenEnvVar}" is not set.`);
            return null;
        }
        plexClients[serverConfig.name] = new PlexAPI({
            hostname: process.env[serverConfig.hostnameEnvVar],
            port: process.env[serverConfig.portEnvVar],
            token: token,
        });
    }
    return plexClients[serverConfig.name];
}

async function fetchPlexMedia(serverConfig, libraryNames, type, count) {
    const plex = getPlexClient(serverConfig);
    if (!plex) return [];

    const sections = await plex.query('/library/sections');
    const allSections = sections?.MediaContainer?.Directory || [];
    let allSummaries = [];

    for (const name of libraryNames) {
        const library = allSections.find(dir => dir.type === type && dir.title === name);
        if (library) {
            try {
                const content = await plex.query(`/library/sections/${library.key}/all`);
                if (content?.MediaContainer?.Metadata) {
                    allSummaries = allSummaries.concat(content.MediaContainer.Metadata);
                }
            } catch (e) {
                console.error(`[${serverConfig.name}] Error fetching library "${name}": ${e.message}`);
            }
        }
    }
    const randomSummaries = shuffleArray(allSummaries).slice(0, count);

    const mediaItemPromises = randomSummaries.map(async (itemSummary) => {
        return processPlexItem(itemSummary, serverConfig);
    });
    const settledItems = await Promise.all(mediaItemPromises);
    return settledItems.filter(item => item !== null);
}

async function fetchPlexRecentlyAdded(serverConfig) {
    const plex = getPlexClient(serverConfig);
    if (!plex) return [];

    const sections = await plex.query('/library/sections');
    const allSections = sections?.MediaContainer?.Directory || [];
    const libraryNames = [
        ...(serverConfig.movieLibraryNames || []),
        ...(serverConfig.showLibraryNames || [])
    ];

    let recentItemsRaw = [];
    for (const name of libraryNames) {
        const library = allSections.find(dir => dir.title === name);
        if (library) {
            try {
                const content = await plex.query(`/library/sections/${library.key}/recentlyAdded?X-Plex-Container-Size=10`);
                if (content?.MediaContainer?.Metadata) {
                    recentItemsRaw = recentItemsRaw.concat(content.MediaContainer.Metadata);
                }
            } catch (e) {
                console.error(`[${serverConfig.name}] Error fetching recently added from library "${name}": ${e.message}`);
            }
        }
    }

    return recentItemsRaw.map(item => {
        const isShow = item.type === 'episode' || item.type === 'season';
        const uniqueKey = `${serverConfig.type}-${serverConfig.name}-${item.ratingKey}`;
        return {
            key: uniqueKey,
            addedAt: item.addedAt,
            title: isShow ? item.grandparentTitle : item.title,
            subtitle: isShow ? `S${item.parentIndex} E${item.index} - ${item.title}` : `${item.year}`,
            posterUrl: `/image?server=${encodeURIComponent(serverConfig.name)}&path=${encodeURIComponent(isShow ? item.grandparentThumb : item.thumb)}`,
        };
    });
}

async function getPlaylistMedia() {
    let allMedia = [];
    const enabledServers = config.mediaServers.filter(s => s.enabled);

    for (const server of enabledServers) {
        if (isDebug) console.log(`[Debug] Fetching from server: ${server.name} (${server.type})`);
        
        let mediaFromServer = [];
        if (server.type === 'plex') {
            const [movies, shows] = await Promise.all([
                fetchPlexMedia(server, server.movieLibraryNames || [], 'movie', server.movieCount || 0),
                fetchPlexMedia(server, server.showLibraryNames || [], 'show', server.showCount || 0)
            ]);
            mediaFromServer = movies.concat(shows);
        } 
        // else if (server.type === 'emby') { ... }
        // else if (server.type === 'jellyfin') { ... }

        if (isDebug) console.log(`[Debug] Fetched ${mediaFromServer.length} items from ${server.name}.`);
        allMedia = allMedia.concat(mediaFromServer);
    }

    return allMedia;
}

let playlistCache = null;
let cacheTimestamp = 0;

// --- API Endpoints ---
app.get('/get-config', (req, res) => {
    res.json({
        clockWidget: config.clockWidget !== false,
        recentlyAddedSidebar: config.recentlyAddedSidebar === true,
        transitionIntervalSeconds: config.transitionIntervalSeconds || 15,
        backgroundRefreshMinutes: config.backgroundRefreshMinutes || 30,
        showClearLogo: config.showClearLogo !== false,
        kenBurnsEffect: config.kenBurnsEffect || { enabled: true, durationSeconds: 20 }
    });
});

app.get('/get-media', async (req, res) => {
    try {
        const cacheDuration = (config.backgroundRefreshMinutes || 30) * 60 * 1000;
        const now = Date.now();

        if (!playlistCache || (now - cacheTimestamp > cacheDuration)) {
            if (isDebug) console.log('[Debug] Cache is stale or empty. Refreshing playlist.');
            const allMedia = await getPlaylistMedia();
            playlistCache = shuffleArray(allMedia);
            cacheTimestamp = now;
            if (isDebug) console.log(`[Debug] Created new playlist with ${playlistCache.length} items.`);
        }
        res.json(shuffleArray([...playlistCache])); // Return a shuffled copy
    } catch (error) {
        console.error('Error fetching media:', error.message);
        res.status(500).json({ error: 'Could not fetch data from Plex.' });
    }
});

app.get('/get-recently-added', async (req, res) => {
    if (config.recentlyAddedSidebar !== true) {
        return res.json([]);
    }
    try {
        const enabledServers = config.mediaServers.filter(s => s.enabled);
        let allRecent = [];

        for (const server of enabledServers) {
            if (server.type === 'plex') {
                const recent = await fetchPlexRecentlyAdded(server);
                allRecent = allRecent.concat(recent);
            }
            // else if (server.type === 'emby') { ... }
        }

        const combined = allRecent
            .sort((a, b) => b.addedAt - a.addedAt)
            .slice(0, 5);
        res.json(combined);
    } catch (error) {
        console.error('Error fetching "Recently Added":', error.message);
        res.status(500).json({ error: 'Could not fetch "Recently Added" data.' });
    }
});

app.get('/get-media-by-key/:key', async (req, res) => {
    try {
        const keyParts = req.params.key.split('-'); // e.g., ['plex', 'My', 'Server', '12345']
        if (keyParts.length < 3) { // Must have at least type, name, and key
            return res.status(400).json({ error: 'Invalid media key format.' });
        }
        const type = keyParts.shift();
        const originalKey = keyParts.pop();
        const serverName = keyParts.join('-'); // Re-join the middle parts
        const serverConfig = config.mediaServers.find(s => s.name === serverName && s.type === type && s.enabled === true);

        if (!serverConfig) {
            return res.status(404).json({ error: 'Server configuration not found for this item.' });
        }

        let mediaItem = null;
        if (type === 'plex') {
            const itemSummary = { key: `/library/metadata/${originalKey}` };
            mediaItem = await processPlexItem(itemSummary, serverConfig);
        }
        if (mediaItem) {
            res.json(mediaItem);
        } else {
            res.status(404).json({ error: 'Media not found or could not be processed.' });
        }
    } catch (error) {
        console.error(`Error fetching media for key ${req.params.key}:`, error.message);
        res.status(500).json({ error: 'Could not fetch data from Plex.' });
    }
});

app.get('/image', async (req, res) => {
    try {
        const serverName = req.query.server;
        const imagePath = req.query.path;

        if (!serverName || !imagePath) {
            return res.status(400).send('Server name or image path is missing');
        }

        const serverConfig = config.mediaServers.find(s => s.name === serverName);
        if (!serverConfig) {
            return res.status(404).send('Server configuration not found');
        }

        const token = process.env[serverConfig.tokenEnvVar];
        if (!token) return res.status(500).send('Server token not configured');

        const hostname = process.env[serverConfig.hostnameEnvVar];
        const port = process.env[serverConfig.portEnvVar];
        const plexImageUrl = `http://${hostname}:${port}${imagePath}?X-Plex-Token=${token}`;
        const plexResponse = await fetch(plexImageUrl);

        if (!plexResponse.ok) {
            return res.status(plexResponse.status).send(plexResponse.statusText);
        }
        res.setHeader('Content-Type', plexResponse.headers.get('content-type'));
        plexResponse.body.pipe(res);
    } catch (error) {
        console.error('Error in image proxy:', error.message);
        res.status(500).send('Could not fetch image');
    }
});

if (isDebug){
    app.get('/debug', async (req, res) => {
        try {
            const allMedia = await getPlaylistMedia();
            res.json({ allMedia: allMedia.map(m => m?._raw) });
        } catch (err) {
            res.status(500).json({error: err.message})
        }
    });
}

app.listen(port, () => {
    console.log(`posterrama.app is running on http://localhost:${port}`);
    if(isDebug) console.log(`Debug endpoint is available at http://localhost:${port}/debug`);
});