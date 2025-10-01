#!/usr/bin/env node

// Test connectivity to configured media sources (Plex, Jellyfin, TMDB)
const fs = require('fs');
const path = require('path');

// Color codes
const colors = {
    red: '\x1b[0;31m',
    green: '\x1b[0;32m',
    yellow: '\x1b[1;33m',
    blue: '\x1b[0;34m',
    nc: '\x1b[0m',
};

function log(level, message) {
    const color = colors[level] || colors.nc;
    console.log(`${color}${message}${colors.nc}`);
}

let errors = 0;
let warnings = 0;
let tested = 0;

function loadConfig() {
    try {
        if (fs.existsSync('config.json')) {
            const content = fs.readFileSync('config.json', 'utf8');
            return JSON.parse(content);
        }
        log('yellow', '⚠️  config.json not found, using example config for structure check');
        if (fs.existsSync('config.example.json')) {
            const content = fs.readFileSync('config.example.json', 'utf8');
            return JSON.parse(content);
        }
        log('red', '❌ No config files found');
        return null;
    } catch (e) {
        log('red', `❌ Error loading config: ${e.message}`);
        return null;
    }
}

function loadEnvVars() {
    const envVars = {};

    // Load from .env if it exists
    if (fs.existsSync('.env')) {
        const content = fs.readFileSync('.env', 'utf8');
        content.split('\n').forEach(line => {
            const [key, ...valueParts] = line.split('=');
            if (key && !line.startsWith('#')) {
                envVars[key.trim()] = valueParts.join('=').trim();
            }
        });
    }

    return envVars;
}

async function testTMDBConnectivity() {
    log('blue', '🎬 Testing TMDB connectivity...');
    tested++;

    try {
        // Simple fetch to TMDB API without API key (should return 401, meaning service is up)
        const response = await fetch('https://api.themoviedb.org/3/movie/popular', {
            method: 'GET',
            headers: { 'User-Agent': 'Posterrama-Release-Check/1.0' },
        });

        if (response.status === 401) {
            log('green', '✅ TMDB: Service reachable (authentication required as expected)');
        } else if (response.status < 500) {
            log('green', '✅ TMDB: Service reachable');
        } else {
            log('red', `❌ TMDB: Service error (${response.status})`);
            errors++;
        }
    } catch (e) {
        log('red', `❌ TMDB: Connection failed - ${e.message}`);
        errors++;
    }
}

async function testPlexConnectivity(config, envVars) {
    const plexServers = config?.mediaServers?.plex || [];

    if (plexServers.length === 0) {
        log('blue', 'ℹ️  Plex: No servers configured');
        return;
    }

    log('blue', `🎭 Testing Plex connectivity (${plexServers.length} servers)...`);

    for (const [index, server] of plexServers.entries()) {
        tested++;

        if (!server.enabled) {
            log('blue', `ℹ️  Plex Server ${index + 1}: Disabled, skipping`);
            continue;
        }

        if (!server.url) {
            log('red', `❌ Plex Server ${index + 1}: No URL configured`);
            errors++;
            continue;
        }

        try {
            const testUrl = new URL('/identity', server.url);
            const response = await fetch(testUrl.toString(), {
                method: 'GET',
                headers: { 'User-Agent': 'Posterrama-Release-Check/1.0' },
                timeout: 10000,
            });

            if (response.ok) {
                log('green', `✅ Plex Server ${index + 1}: Reachable (${server.url})`);
            } else if (response.status === 401 || response.status === 403) {
                log(
                    'green',
                    `✅ Plex Server ${index + 1}: Reachable but needs authentication (${server.url})`
                );
            } else {
                log(
                    'yellow',
                    `⚠️  Plex Server ${index + 1}: Unexpected response ${response.status} (${server.url})`
                );
                warnings++;
            }
        } catch (e) {
            log(
                'red',
                `❌ Plex Server ${index + 1}: Connection failed - ${e.message} (${server.url})`
            );
            errors++;
        }
    }
}

async function testJellyfinConnectivity(config, envVars) {
    const jellyfinServers = config?.mediaServers?.jellyfin || [];

    if (jellyfinServers.length === 0) {
        log('blue', 'ℹ️  Jellyfin: No servers configured');
        return;
    }

    log('blue', `🐙 Testing Jellyfin connectivity (${jellyfinServers.length} servers)...`);

    for (const [index, server] of jellyfinServers.entries()) {
        tested++;

        if (!server.enabled) {
            log('blue', `ℹ️  Jellyfin Server ${index + 1}: Disabled, skipping`);
            continue;
        }

        if (!server.url) {
            log('red', `❌ Jellyfin Server ${index + 1}: No URL configured`);
            errors++;
            continue;
        }

        try {
            const testUrl = new URL('/System/Info/Public', server.url);
            const response = await fetch(testUrl.toString(), {
                method: 'GET',
                headers: { 'User-Agent': 'Posterrama-Release-Check/1.0' },
                timeout: 10000,
            });

            if (response.ok) {
                log('green', `✅ Jellyfin Server ${index + 1}: Reachable (${server.url})`);
            } else if (response.status === 401 || response.status === 403) {
                log(
                    'green',
                    `✅ Jellyfin Server ${index + 1}: Reachable but needs authentication (${server.url})`
                );
            } else {
                log(
                    'yellow',
                    `⚠️  Jellyfin Server ${index + 1}: Unexpected response ${response.status} (${server.url})`
                );
                warnings++;
            }
        } catch (e) {
            log(
                'red',
                `❌ Jellyfin Server ${index + 1}: Connection failed - ${e.message} (${server.url})`
            );
            errors++;
        }
    }
}

function checkConfiguredSources(config) {
    log('blue', '🔍 Checking configured media sources...');

    const sources = [];

    if (config?.mediaServers?.plex?.length > 0) {
        const enabled = config.mediaServers.plex.filter(s => s.enabled).length;
        sources.push(`Plex (${enabled}/${config.mediaServers.plex.length} enabled)`);
    }

    if (config?.mediaServers?.jellyfin?.length > 0) {
        const enabled = config.mediaServers.jellyfin.filter(s => s.enabled).length;
        sources.push(`Jellyfin (${enabled}/${config.mediaServers.jellyfin.length} enabled)`);
    }

    if (config?.tmdbSource?.enabled !== false) {
        sources.push('TMDB (enabled)');
    }

    if (sources.length === 0) {
        log('yellow', '⚠️  No media sources configured or enabled');
        warnings++;
    } else {
        log('green', `✅ Configured sources: ${sources.join(', ')}`);
    }
}

// Main connectivity testing
async function main() {
    console.log('🔍 Testing media source connectivity...\n');

    const config = loadConfig();
    const envVars = loadEnvVars();

    if (!config) {
        process.exit(1);
    }

    checkConfiguredSources(config);

    // Test each source type
    await testTMDBConnectivity();
    await testPlexConnectivity(config, envVars);
    await testJellyfinConnectivity(config, envVars);

    // Summary
    console.log('\n📊 Media Source Connectivity Summary:');
    log('blue', `🔗 Total tests performed: ${tested}`);

    if (errors === 0 && warnings === 0) {
        log('green', '✅ All configured media sources are reachable');
        process.exit(0);
    } else {
        if (errors > 0) {
            log('red', `❌ ${errors} connection error(s) found`);
        }
        if (warnings > 0) {
            log('yellow', `⚠️  ${warnings} warning(s) found`);
        }
        process.exit(errors > 0 ? 1 : 0);
    }
}

// Add fetch timeout support for older Node.js versions
const originalFetch = globalThis.fetch;
if (originalFetch) {
    globalThis.fetch = function (url, options = {}) {
        const timeout = options.timeout || 15000;
        delete options.timeout;

        return Promise.race([
            originalFetch(url, options),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Request timeout')), timeout)
            ),
        ]);
    };
}

main().catch(e => {
    log('red', `❌ Unexpected error: ${e.message}`);
    process.exit(1);
});
