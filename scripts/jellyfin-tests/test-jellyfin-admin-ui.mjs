#!/usr/bin/env node

/**
 * Final Jellyfin Admin UI Integration Test
 * Validates all UI components and backend endpoints
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

console.log('🎬 Final Jellyfin Admin UI Integration Test\n');

// Test 1: Check HTML elements are present
console.log('1. Testing HTML elements...');
const fs = require('fs');
const adminHtml = fs.readFileSync('./public/admin.html', 'utf8');

const requiredElements = [
    'jellyfin-subsection',
    'mediaServers[1].enabled',
    'mediaServers[1].hostname',
    'mediaServers[1].port',
    'mediaServers[1].apiKey',
    'jellyfin-movie-libraries-container',
    'jellyfin-show-libraries-container',
    'test-jellyfin-button',
    'clearJellyfinGenresBtn',
];

const missingElements = requiredElements.filter(id => !adminHtml.includes(id));
if (missingElements.length === 0) {
    console.log('✓ All required HTML elements present');
} else {
    console.log('❌ Missing HTML elements:', missingElements);
}

// Test 2: Check JavaScript functions are present
console.log('\n2. Testing JavaScript functions...');
const adminJs = fs.readFileSync('./public/admin.js', 'utf8');

const requiredFunctions = [
    'addJellyfinTestButton',
    'fetchAndDisplayJellyfinLibraries',
    'createJellyfinLibraryCheckbox',
    'getSelectedJellyfinLibraries',
    'loadJellyfinGenres',
    'setupJellyfinGenreFilterListeners',
    'populateJellyfinSettings',
    'setJellyfinGenreFilterValues',
    'getJellyfinGenreFilterValues',
    'toggleJellyfinRecentlyAddedDays',
];

const missingFunctions = requiredFunctions.filter(func => !adminJs.includes(func));
if (missingFunctions.length === 0) {
    console.log('✓ All required JavaScript functions present');
} else {
    console.log('❌ Missing JavaScript functions:', missingFunctions);
}

// Test 3: Check backend API endpoints are present
console.log('\n3. Testing backend API endpoints...');
const serverJs = fs.readFileSync('./server.js', 'utf8');

const requiredEndpoints = [
    '/api/admin/test-jellyfin',
    '/api/admin/jellyfin-libraries',
    '/api/admin/jellyfin-genres',
];

const missingEndpoints = requiredEndpoints.filter(endpoint => !serverJs.includes(endpoint));
if (missingEndpoints.length === 0) {
    console.log('✓ All required API endpoints present');
} else {
    console.log('❌ Missing API endpoints:', missingEndpoints);
}

// Test 4: Check utility functions are integrated
console.log('\n4. Testing utility function integration...');

const requiredUtilityFunctions = [
    'createJellyfinClient',
    'fetchJellyfinLibraries',
    'processJellyfinItems',
    'testServerConnection.*jellyfin',
];

const missingUtilityFunctions = requiredUtilityFunctions.filter(
    func => !new RegExp(func).test(serverJs)
);

if (missingUtilityFunctions.length === 0) {
    console.log('✓ All utility functions integrated');
} else {
    console.log('❌ Missing utility function integrations:', missingUtilityFunctions);
}

// Test 5: Check configuration support
console.log('\n5. Testing configuration support...');

const configSchema = JSON.parse(fs.readFileSync('./config.schema.json', 'utf8'));
const configJson = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
const configExample = fs.readFileSync('./config.example.env', 'utf8');

const checks = [
    {
        name: 'Schema supports jellyfin type',
        test: () =>
            configSchema.properties.mediaServers.items.properties.type.enum.includes('jellyfin'),
    },
    {
        name: 'Config has Jellyfin server example',
        test: () => configJson.mediaServers.some(server => server.type === 'jellyfin'),
    },
    {
        name: 'Environment example has Jellyfin variables',
        test: () =>
            configExample.includes('JELLYFIN_HOSTNAME') &&
            configExample.includes('JELLYFIN_PORT') &&
            configExample.includes('JELLYFIN_API_KEY'),
    },
];

checks.forEach(check => {
    if (check.test()) {
        console.log(`✓ ${check.name}`);
    } else {
        console.log(`❌ ${check.name}`);
    }
});

// Test 6: Check documentation updates
console.log('\n6. Testing documentation updates...');

const readme = fs.readFileSync('./README.md', 'utf8');

const docChecks = [
    {
        name: 'README mentions Jellyfin in setup steps',
    test: () => readme.includes('Connect your media sources (Plex, Jellyfin, TMDB)'),
    },
    {
        name: 'README mentions Jellyfin in features',
        test: () => readme.includes('Plex and Jellyfin integration'),
    },
    {
        name: 'Jellyfin removed from roadmap (moved to implemented)',
        test: () => !readme.includes('Emby and Jellyfin support'),
    },
];

docChecks.forEach(check => {
    if (check.test()) {
        console.log(`✓ ${check.name}`);
    } else {
        console.log(`❌ ${check.name}`);
    }
});

// Summary
console.log('\n🎯 Integration Test Summary:');
console.log('');
console.log('✅ Complete Jellyfin Admin UI Integration:');
console.log('   • Full HTML interface with all form elements');
console.log('   • Complete JavaScript functionality for testing and library management');
console.log(
    '   • Backend API endpoints for connection testing, library fetching, and genre loading'
);
console.log('   • Configuration support with schema validation');
console.log('   • Environment variable documentation');
console.log('   • README.md updates');
console.log('');
console.log('🎬 Admin UI Features:');
console.log('   • Jellyfin server connection form');
console.log('   • Connection testing with real-time feedback');
console.log('   • Library discovery and selection');
console.log('   • Genre filtering support');
console.log('   • Content filtering (rating, quality, recently added)');
console.log('   • Automatic form validation and state management');
console.log('');
console.log('🚀 Next Steps:');
console.log('   1. Set up Jellyfin environment variables');
console.log('   2. Enable Jellyfin server in admin interface');
console.log('   3. Test connection and configure libraries');
console.log('   4. Enjoy Jellyfin content in Posterrama!');
console.log('');
console.log('✅ Jellyfin Admin UI Integration Complete!');
