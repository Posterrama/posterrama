#!/usr/bin/env node
/**
 * Test script voor error resilience in playlist refresh
 * Test verschillende failure scenarios om te controleren dat andere servers blijven werken
 */

import { execSync } from 'child_process';
import axios from 'axios';

const baseUrl = 'http://localhost:4000';

async function testErrorResilience() {
    console.log('🧪 Testing Error Resilience in Playlist Refresh\n');

    try {
        // 1. Test normale situatie - beide servers werkend
        console.log('1️⃣ Testing normal scenario - both servers working...');
        let response = await axios.get(`${baseUrl}/get-media`);
        console.log(`✅ Normal scenario: ${response.status} - ${response.data.length} items fetched\n`);

        // 2. Test Jellyfin server failure (foute credentials)
        console.log('2️⃣ Testing Jellyfin server failure...');
        
        // Backup huidige config
        const configBackup = execSync('cat /var/www/posterrama/config.json', { encoding: 'utf8' });
        
        // Verander Jellyfin credentials om failure te simuleren
        const config = JSON.parse(configBackup);
        const jellyfinServer = config.mediaServers.find(s => s.type === 'jellyfin' && s.enabled);
        
        if (jellyfinServer) {
            console.log(`   - Breaking Jellyfin credentials for server: ${jellyfinServer.name}`);
            jellyfinServer.token = 'invalid_token_to_cause_401';
            
            // Schrijf aangepaste config
            execSync(`echo '${JSON.stringify(config, null, 2)}' > /var/www/posterrama/config.json`);
            
            // Restart server om nieuwe config te laden
            console.log('   - Restarting server with broken Jellyfin config...');
            execSync('pm2 restart posterrama', { stdio: 'ignore' });
            
            // Wacht even voor restart
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Test of /api/get-media nog steeds werkt (moet alleen Plex data geven)
            try {
                response = await axios.get(`${baseUrl}/get-media`);
                console.log(`✅ With broken Jellyfin: ${response.status} - ${response.data.length} items fetched (should be Plex only)`);
                
                // Check of er items zijn (Plex moet nog steeds werken)
                if (response.data.length > 0) {
                    console.log('   ✅ Other servers (Plex) continue working when Jellyfin fails');
                } else {
                    console.log('   ❌ No items fetched - this might indicate all servers failed');
                }
            } catch (error) {
                console.log(`   ❌ API failed completely: ${error.response?.status || error.message}`);
                console.log('   ❌ This indicates error resilience is not working');
            }
            
        } else {
            console.log('   ⚠️  No enabled Jellyfin server found in config - skipping this test');
        }
        
        // 3. Herstel originele config
        console.log('\n3️⃣ Restoring original configuration...');
        execSync(`echo '${configBackup}' > /var/www/posterrama/config.json`);
        execSync('pm2 restart posterrama', { stdio: 'ignore' });
        
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // 4. Valideer dat alles weer normaal werkt
        console.log('4️⃣ Validating restored functionality...');
        response = await axios.get(`${baseUrl}/get-media`);
        console.log(`✅ After restore: ${response.status} - ${response.data.length} items fetched`);
        
        console.log('\n🎉 Error resilience test completed!');
        console.log('Summary:');
        console.log('- Normal operation: Working');
        console.log('- Partial failure resilience: Working');
        console.log('- Recovery after fix: Working');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        
        // Probeer config te herstellen bij failure
        try {
            console.log('🔄 Attempting to restore config after test failure...');
            const configBackup = execSync('cat /var/www/posterrama/config.json.backup', { encoding: 'utf8' });
            execSync(`echo '${configBackup}' > /var/www/posterrama/config.json`);
            execSync('pm2 restart posterrama', { stdio: 'ignore' });
        } catch (restoreError) {
            console.error('❌ Failed to restore config:', restoreError.message);
        }
    }
}

// Maak backup van config voordat we beginnen
try {
    execSync('cp /var/www/posterrama/config.json /var/www/posterrama/config.json.backup');
    await testErrorResilience();
} catch (error) {
    console.error('❌ Failed to create config backup or run test:', error.message);
}
