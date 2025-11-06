#!/usr/bin/env node
/**
 * Helper script to list available Jellyfin items
 * Helps you find item IDs for testing metadata extraction
 */

const axios = require('axios');
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));

async function listJellyfinItems() {
    const jellyfinServer = config.mediaServers?.find(s => s.type === 'jellyfin' && s.enabled);

    if (!jellyfinServer) {
        console.error('❌ No enabled Jellyfin server found in config');
        process.exit(1);
    }

    const { hostname, port = 8096, apiKey, userId } = jellyfinServer;
    const protocol = port === 8920 || port === 443 ? 'https' : 'http';
    const baseUrl = `${protocol}://${hostname}:${port}`;

    console.log(`\n🔍 Fetching Jellyfin items from: ${baseUrl}\n`);

    try {
        // Get all movies
        const response = await axios.get(`${baseUrl}/Users/${userId || 'me'}/Items`, {
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
