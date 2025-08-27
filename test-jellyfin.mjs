// Test script for Jellyfin SDK
import { Jellyfin } from '@jellyfin/sdk';

console.log('Jellyfin SDK loaded successfully');

// Create a basic client with required parameters
const jellyfin = new Jellyfin({
    clientInfo: {
        name: 'Posterrama Test',
        version: '1.0.0'
    },
    deviceInfo: {
        name: 'Posterrama',
        id: 'posterrama-test'
    }
});

console.log('Jellyfin instance created');

try {
    const api = jellyfin.createApi('http://localhost:8096');
    console.log('API instance created for:', api.basePath);
    
    // Try to import specific API modules
    console.log('\n=== Testing API imports ===');
    
    try {
        const { UserApi } = await import('@jellyfin/sdk/lib/generated-client/api/user-api.js');
        const { LibraryApi } = await import('@jellyfin/sdk/lib/generated-client/api/library-api.js');
        const { ItemsApi } = await import('@jellyfin/sdk/lib/generated-client/api/items-api.js');
        const { SystemApi } = await import('@jellyfin/sdk/lib/generated-client/api/system-api.js');
        
        console.log('Successfully imported API classes');
        
        // Create API instances
        const userApi = new UserApi(undefined, api.basePath, api.axiosInstance);
        const libraryApi = new LibraryApi(undefined, api.basePath, api.axiosInstance);
        const itemsApi = new ItemsApi(undefined, api.basePath, api.axiosInstance);
        const systemApi = new SystemApi(undefined, api.basePath, api.axiosInstance);
        
        console.log('User API methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(userApi)).filter(m => !m.startsWith('_')));
        console.log('Library API methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(libraryApi)).filter(m => !m.startsWith('_')));
        console.log('Items API methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(itemsApi)).filter(m => !m.startsWith('_')));
        console.log('System API methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(systemApi)).filter(m => !m.startsWith('_')));
        
    } catch (e) {
        console.log('Import error:', e.message);
        
        // Fallback: list all available API files
        console.log('\n=== Listing available API files ===');
        const fs = await import('fs');
        const path = await import('path');
        
        const apiDir = 'node_modules/@jellyfin/sdk/lib/generated-client/api/';
        const files = fs.default.readdirSync(apiDir);
        console.log('Available API files:', files.filter(f => f.endsWith('-api.js')));
    }
    
} catch (error) {
    console.log('Error:', error.message);
}
