#!/usr/bin/env node
const { getJellyfinClient } = require('./lib/jellyfin-helpers');
const config = require('./config');

(async () => {
    try {
        const jellyfinServers = config.mediaServers.filter(s => s.type === 'jellyfin');
        if (!jellyfinServers.length) {
            console.log('No Jellyfin servers configured');
            return;
        }

        const jellyfinConfig = jellyfinServers[0];
        const client = await getJellyfinClient(jellyfinConfig);

        console.log('Searching for Alien: Romulus...\n');

        const result = await client.getItems({
            searchTerm: 'Alien Romulus',
            includeItemTypes: ['Movie'],
            recursive: true,
            fields: ['People', 'Studios', 'Genres', 'ProviderIds', 'Overview'],
            limit: 1,
        });

        if (!result.Items || !result.Items.length) {
            console.log('Movie not found');
            return;
        }

        const item = result.Items[0];
        console.log('Title:', item.Name);
        console.log('Year:', item.ProductionYear);
        console.log('\n=== METADATA AVAILABILITY ===');
        console.log('Has People:', 'People' in item, '- Count:', item.People?.length || 0);
        console.log('Has Studios:', 'Studios' in item, '- Count:', item.Studios?.length || 0);
        console.log('Has Genres:', 'Genres' in item, '- Value:', item.Genres);
        console.log(
            'Has ProviderIds:',
            'ProviderIds' in item,
            '- Keys:',
            Object.keys(item.ProviderIds || {})
        );
        console.log('Has Overview:', 'Overview' in item, '- Length:', item.Overview?.length || 0);

        if (item.People && item.People.length > 0) {
            console.log('\n=== CAST (first 5) ===');
            item.People.filter(p => p.Type === 'Actor')
                .slice(0, 5)
                .forEach(p => console.log(`  - ${p.Name} as ${p.Role}`));

            console.log('\n=== DIRECTORS ===');
            item.People.filter(p => p.Type === 'Director').forEach(p =>
                console.log(`  - ${p.Name}`)
            );
        }

        if (item.Studios && item.Studios.length > 0) {
            console.log('\n=== STUDIOS ===');
            item.Studios.forEach(s => console.log(`  - ${s.Name}`));
        }
    } catch (e) {
        console.error('Error:', e.message);
        console.error(e.stack);
    }
})();
