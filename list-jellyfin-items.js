#!/usr/bin/env node
/**
 * Helper script to list available Jellyfin items
 * Helps you find item IDs for testing metadata extraction
 */

const axios = require('axios');
const fs = require('fs');
require('dotenv').config();
const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));

async function listJellyfinItems() {
    const jellyfinServer = config.mediaServers?.find(s => s.type === 'jellyfin' && s.enabled);

    if (!jellyfinServer) {
        console.error('❌ No enabled Jellyfin server found in config');
        process.exit(1);
    }

    const hostname = jellyfinServer.hostname;
    const port = jellyfinServer.port || 8096;
    const apiKey =
        jellyfinServer.apiKey ||
        jellyfinServer.token ||
        (jellyfinServer.tokenEnvVar ? process.env[jellyfinServer.tokenEnvVar] : null);
    const userId =
        jellyfinServer.userId ||
        (jellyfinServer.userIdEnvVar ? process.env[jellyfinServer.userIdEnvVar] : null);
    const protocol = port === 8920 || port === 443 ? 'https' : 'http';
    const baseUrl = `${protocol}://${hostname}:${port}`;

    console.log(`\n🔍 Fetching Jellyfin items from: ${baseUrl}\n`);

    // Get user ID if not configured
    let effectiveUserId = userId;
    if (!effectiveUserId) {
        try {
            const userResponse = await axios.get(`${baseUrl}/Users`, {
                headers: {
                    'X-Emby-Token': apiKey,
                },
            });
            if (userResponse.data && userResponse.data.length > 0) {
                effectiveUserId = userResponse.data[0].Id;
                console.log(
                    `📋 Using first user: ${userResponse.data[0].Name} (${effectiveUserId})\n`
                );
            }
        } catch (err) {
            console.error('❌ Failed to fetch users:', err.message);
            process.exit(1);
        }
    }

    try {
        // Get all movies
        const response = await axios.get(`${baseUrl}/Users/${effectiveUserId}/Items`, {
            headers: {
                'X-Emby-Token': apiKey,
            },
            params: {
                IncludeItemTypes: 'Movie',
                Recursive: true,
                Fields: 'ProductionYear,ProviderIds,CommunityRating',
                Limit: 20,
                SortBy: 'DateCreated',
                SortOrder: 'Descending',
            },
        });

        const items = response.data.Items || [];

        console.log(
            `📽️  Found ${response.data.TotalRecordCount} total movies. Showing first ${items.length}:\n`
        );

        items.forEach((item, index) => {
            console.log(`${index + 1}. ${item.Name} (${item.ProductionYear || 'unknown'})`);
            console.log(`   ID: ${item.Id}`);
            console.log(
                `   Rating: ${item.CommunityRating || 'N/A'} | IMDB: ${item.ProviderIds?.Imdb || 'N/A'}`
            );
            console.log();
        });

        console.log(
            '\n💡 To test metadata extraction, copy an ID above and run:\n   node test-jellyfin-metadata-extraction.js <ID>\n'
        );
    } catch (error) {
        console.error('❌ Error:', error.message);
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', JSON.stringify(error.response.data, null, 2));
        }
        process.exit(1);
    }
}

listJellyfinItems();
