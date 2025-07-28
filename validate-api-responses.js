#!/usr/bin/env node

/**
 * API Response Validation Script
 * Tests actual API responses against documented schemas
 */

const request = require('supertest');
const fs = require('fs');

async function validateApiDocumentation() {
    console.log('🧪 API Response Schema Validation\n');
    
    // Import the app (but don't start the full server)
    let app;
    try {
        // Temporarily suppress console output during app loading
        const originalConsole = { ...console };
        console.log = console.error = console.warn = () => {};
        
        app = require('./server.js');
        
        // Restore console
        Object.assign(console, originalConsole);
        console.log('✅ Server module loaded successfully\n');
    } catch (error) {
        console.error('❌ Failed to load server module:', error.message);
        return;
    }

    // Define test cases for key endpoints
    const testCases = [
        {
            name: 'GET /health - Basic Health Check',
            method: 'get',
            path: '/health',
            expectedStatus: 200,
            expectedSchema: {
                type: 'object',
                required: ['status', 'service', 'version', 'timestamp', 'uptime'],
                properties: {
                    status: { type: 'string' },
                    service: { type: 'string' },
                    version: { type: 'string' },
                    timestamp: { type: 'string' },
                    uptime: { type: 'number' }
                }
            }
        },
        {
            name: 'GET /get-config - Configuration',
            method: 'get', 
            path: '/get-config',
            expectedStatus: 200,
            expectedSchema: {
                type: 'object',
                properties: {
                    clockWidget: { type: 'boolean' },
                    transitionIntervalSeconds: { type: 'number' },
                    backgroundRefreshMinutes: { type: 'number' },
                    showClearLogo: { type: 'boolean' },
                    showPoster: { type: 'boolean' },
                    showMetadata: { type: 'boolean' },
                    showRottenTomatoes: { type: 'boolean' },
                    rottenTomatoesMinimumScore: { type: 'number' },
                    kenBurnsEffect: { type: 'object' }
                }
            }
        },
        {
            name: 'GET /api/v1/config - Config Alias',
            method: 'get',
            path: '/api/v1/config', 
            expectedStatus: 200,
            shouldMatchPath: '/get-config'
        },
        {
            name: 'GET /get-media - Media Playlist',
            method: 'get',
            path: '/get-media',
            expectedStatus: [200, 202, 503], // Multiple valid responses
            skipSchemaValidation: true // Can vary based on server state
        },
        {
            name: 'GET /api/v1/media - Media Alias',
            method: 'get',
            path: '/api/v1/media',
            expectedStatus: [200, 202, 503],
            shouldMatchPath: '/get-media'
        },
        {
            name: 'GET /image - Image Proxy (missing params)',
            method: 'get',
            path: '/image',
            expectedStatus: 400,
            expectedSchema: {
                type: 'object',
                properties: {
                    error: { type: 'string' }
                }
            }
        }
    ];

    let passed = 0;
    let failed = 0;

    for (const testCase of testCases) {
        console.log(`🔍 Testing: ${testCase.name}`);
        
        try {
            const response = await request(app)[testCase.method](testCase.path);
            
            // Check status code
            const expectedStatuses = Array.isArray(testCase.expectedStatus) 
                ? testCase.expectedStatus 
                : [testCase.expectedStatus];
                
            if (!expectedStatuses.includes(response.status)) {
                console.log(`   ❌ Status: Expected ${expectedStatuses.join(' or ')}, got ${response.status}`);
                failed++;
                continue;
            } else {
                console.log(`   ✅ Status: ${response.status}`);
            }

            // Check if response should match another path
            if (testCase.shouldMatchPath) {
                const originalResponse = await request(app)[testCase.method](testCase.shouldMatchPath);
                if (JSON.stringify(response.body) === JSON.stringify(originalResponse.body)) {
                    console.log(`   ✅ Alias: Matches ${testCase.shouldMatchPath}`);
                } else {
                    console.log(`   ❌ Alias: Does not match ${testCase.shouldMatchPath}`);
                    failed++;
                    continue;
                }
            }

            // Validate schema if provided and not skipped
            if (testCase.expectedSchema && !testCase.skipSchemaValidation) {
                const validation = validateSchema(response.body, testCase.expectedSchema);
                if (validation.valid) {
                    console.log(`   ✅ Schema: Valid`);
                } else {
                    console.log(`   ❌ Schema: ${validation.errors.join(', ')}`);
                    failed++;
                    continue;
                }
            } else if (testCase.skipSchemaValidation) {
                console.log(`   ⚠️  Schema: Skipped (response varies by server state)`);
            }

            // Check response headers for caching endpoints
            if (testCase.path.includes('config') || testCase.path.includes('media')) {
                if (response.headers['cache-control']) {
                    console.log(`   ✅ Caching: Cache-Control header present`);
                } else {
                    console.log(`   ⚠️  Caching: No Cache-Control header`);
                }
            }

            passed++;
            console.log(`   ✅ PASSED\n`);

        } catch (error) {
            console.log(`   ❌ ERROR: ${error.message}`);
            failed++;
            console.log(`   ❌ FAILED\n`);
        }
    }

    // Test Swagger UI availability 
    console.log('🔍 Testing: Swagger UI Availability');
    try {
        const swaggerResponse = await request(app).get('/api-docs/');
        if (swaggerResponse.status === 200 && swaggerResponse.text.includes('swagger')) {
            console.log('   ✅ Swagger UI is accessible');
            console.log('   ✅ PASSED\n');
            passed++;
        } else {
            console.log(`   ❌ Swagger UI returned status ${swaggerResponse.status}`);
            console.log('   ❌ FAILED\n');
            failed++;
        }
    } catch (error) {
        console.log(`   ❌ ERROR: ${error.message}`);
        console.log('   ❌ FAILED\n');
        failed++;
    }

    // Summary
    console.log('📊 VALIDATION SUMMARY');
    console.log('═'.repeat(50));
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📈 Success Rate: ${Math.round((passed / (passed + failed)) * 100)}%`);

    if (failed === 0) {
        console.log('\n🎉 All API endpoints match their documentation!');
    } else {
        console.log(`\n⚠️  ${failed} endpoint(s) have documentation mismatches.`);
    }

    console.log('\n💡 NEXT STEPS:');
    console.log('1. Start server: npm start');
    console.log('2. Visit: http://localhost:4000/api-docs');
    console.log('3. Test API endpoints interactively');
    console.log('4. Verify all schemas match actual responses');
}

// Simple schema validation function
function validateSchema(data, schema) {
    const errors = [];
    
    if (schema.type === 'object') {
        if (typeof data !== 'object' || data === null) {
            return { valid: false, errors: ['Expected object'] };
        }
        
        if (schema.required) {
            for (const field of schema.required) {
                if (!(field in data)) {
                    errors.push(`Missing required field: ${field}`);
                }
            }
        }
        
        if (schema.properties) {
            for (const [field, fieldSchema] of Object.entries(schema.properties)) {
                if (field in data) {
                    const fieldValidation = validateSchema(data[field], fieldSchema);
                    if (!fieldValidation.valid) {
                        errors.push(`${field}: ${fieldValidation.errors.join(', ')}`);
                    }
                }
            }
        }
    } else if (schema.type && typeof data !== schema.type) {
        errors.push(`Expected ${schema.type}, got ${typeof data}`);
    }
    
    return { valid: errors.length === 0, errors };
}

// Run if called directly
if (require.main === module) {
    validateApiDocumentation().catch(console.error);
}

module.exports = { validateApiDocumentation };
