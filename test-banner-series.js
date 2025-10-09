#!/usr/bin/env node
/**
 * Test script to check banner field extraction for TV series
 */

const AdmZip = require('adm-zip');
const fs = require('fs');

console.log('╔══════════════════════════════════════════════════════════════════╗');
console.log('║                                                                  ║');
console.log('║   SERIES BANNER INVESTIGATION                                    ║');
console.log('║                                                                  ║');
console.log('╚══════════════════════════════════════════════════════════════════╝\n');

// Check multiple series posterpacks
const seriesZips = [
    'media/complete/plex-export/Ted Lasso (2020).zip',
    'media/complete/plex-export/Bridgerton (2020).zip',
    'media/complete/plex-export/Star Trek Picard (2020).zip',
];

seriesZips.forEach(zipPath => {
    if (!fs.existsSync(zipPath)) {
        console.log(`⚠️  Not found: ${zipPath}\n`);
        return;
    }

    console.log(`📦 ${zipPath.split('/').pop()}`);

    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();

    // Check for banner file
    const hasBanner = entries.some(
        e => e.entryName === 'banner.jpg' || e.entryName === 'banner.png'
    );
    console.log(`   Banner file: ${hasBanner ? '✅ YES' : '❌ NO'}`);

    // Check metadata
    const metaEntry = zip.getEntry('metadata.json');
    if (metaEntry) {
        const meta = JSON.parse(metaEntry.getData().toString('utf8'));
        console.log(`   metadata.images.banner: ${meta.images?.banner || false}`);
        console.log(`   Type: ${meta.type || 'unknown'}`);
        console.log(`   Source: ${meta.source || 'unknown'}`);
    }

    console.log('');
});

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
console.log('📋 ANALYSIS\n');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
console.log('According to Plex API documentation:');
console.log('  - Banner is available for: Series, Collections');
console.log('  - API field: banner');
console.log('  - Expected in ZIP: banner.jpg\n');
console.log('Current issue:');
console.log('  - Series posterpacks missing banner.jpg file');
console.log('  - metadata.images.banner = false\n');
console.log('Possible causes:');
console.log('  1. sourceItem.banner not present in Plex response');
console.log('  2. Banner download failing in job-queue');
console.log('  3. Banner URL not being extracted correctly\n');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
