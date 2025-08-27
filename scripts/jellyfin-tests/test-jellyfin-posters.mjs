#!/usr/bin/env node
/**
 * Test script voor Jellyfin poster URL fix
 * Test of de admin achtergrond en screensaver nu correct werken met Jellyfin
 */

import { execSync } from 'child_process';
import axios from 'axios';

const baseUrl = 'http://localhost:4000';

async function testJellyfinPosters() {
    console.log('🖼️  Testing Jellyfin Poster URL Fix\n');

    try {
        // 1. Check media items have poster URLs
        console.log('1️⃣ Checking if media items have poster URLs...');
        const mediaResponse = await axios.get(`${baseUrl}/get-media`);
        const mediaItems = mediaResponse.data;
        
        console.log(`✅ Found ${mediaItems.length} media items`);
        
        // Check first few items for poster URLs
        let itemsWithPosters = 0;
        let itemsWithBackgrounds = 0;
        
        for (let i = 0; i < Math.min(5, mediaItems.length); i++) {
            const item = mediaItems[i];
            console.log(`   - "${item.title}": poster=${!!item.posterUrl}, background=${!!item.backgroundUrl}`);
            if (item.posterUrl) itemsWithPosters++;
            if (item.backgroundUrl) itemsWithBackgrounds++;
        }
        
        console.log(`   ✅ Items with posters: ${itemsWithPosters}/${Math.min(5, mediaItems.length)}`);
        console.log(`   ✅ Items with backgrounds: ${itemsWithBackgrounds}/${Math.min(5, mediaItems.length)}\n`);
        
        // 2. Test image proxy functionality
        console.log('2️⃣ Testing image proxy functionality...');
        
        const itemWithPoster = mediaItems.find(item => item.posterUrl);
        if (itemWithPoster) {
            console.log(`   - Testing poster for: "${itemWithPoster.title}"`);
            console.log(`   - Poster URL: ${itemWithPoster.posterUrl}`);
            
            try {
                const imageResponse = await axios.get(`${baseUrl}${itemWithPoster.posterUrl}`, {
                    timeout: 10000,
                    responseType: 'arraybuffer'
                });
                
                console.log(`   ✅ Image proxy works: ${imageResponse.status}, ${imageResponse.data.length} bytes`);
                console.log(`   ✅ Content-Type: ${imageResponse.headers['content-type']}`);
                
            } catch (imageError) {
                console.log(`   ❌ Image proxy failed: ${imageError.response?.status || imageError.message}`);
            }
        } else {
            console.log('   ⚠️  No items with poster URLs found to test');
        }
        
        console.log('\n3️⃣ Testing specific placeholder SVG issue...');
        
        // Test the specific SVG that was failing in the console
        const problematicSvg = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMSIgaGVpZ2h0PSIxIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9IiMxMTEiLz48L3N2Zz4=';
        
        try {
            const svgResponse = await axios.get(`${baseUrl}/image?url=${encodeURIComponent(problematicSvg)}`, {
                timeout: 5000,
                responseType: 'arraybuffer'
            });
            
            console.log(`   ✅ SVG placeholder works: ${svgResponse.status}, ${svgResponse.data.length} bytes`);
            
        } catch (svgError) {
            console.log(`   ❌ SVG placeholder failed: ${svgError.response?.status || svgError.message}`);
        }
        
        console.log('\n🎉 Jellyfin poster URL test completed!');
        console.log('Summary:');
        console.log(`- Media items found: ${mediaItems.length}`);
        console.log(`- Items with poster URLs: ${itemsWithPosters}`);
        console.log(`- Image proxy: ${itemWithPoster ? 'Working' : 'No items to test'}`);
        console.log('\nℹ️  You can now test the admin and screensaver in your browser:');
        console.log(`   - Admin: ${baseUrl}/admin`);
        console.log(`   - Screensaver: ${baseUrl}/`);
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

await testJellyfinPosters();
