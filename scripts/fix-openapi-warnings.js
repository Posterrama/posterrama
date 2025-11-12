#!/usr/bin/env node

/**
 * Fix OpenAPI spec warnings by adding missing 200 responses and security definitions
 */

const fs = require('fs');
const path = require('path');

const specPath = path.join(__dirname, '../docs/openapi-latest.json');

console.log('📝 Loading OpenAPI spec...');
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));

let fixedCount = 0;
let response200Count = 0;
let securityCount = 0;
let exampleCount = 0;

// Public endpoints that should have security: []
// Using wildcard patterns to match all public endpoints efficiently
const isPublicEndpoint = (method, path) => {
    const key = `${method} ${path}`;

    // Explicit public endpoints
    const publicPaths = [
        'GET /',
        'GET /index.html',
        'GET /admin',
        'GET /admin/login',
        'GET /admin/2fa-verify',
        'GET /admin/logout',
        'GET /admin-analytics',
        'GET /screensaver',
        'GET /wallart',
        'GET /cinema',
        'GET /setup.html',
        'GET /login.html',
        'GET /logs.html',
        'GET /2fa-verify.html',
        'GET /preview',
        'GET /reset-refresh',
        'GET /health',
        'GET /get-media',
        'GET /get-config',
        'GET /proxy',
        'GET /image',
        'GET /local-media',
        'GET /local-media/{path}',
        'GET /local-posterpack',
        'GET /[site]',
        'GET /[site]/*',
        'POST /csp-report',
    ];

    if (publicPaths.includes(key)) return true;

    // Public API patterns
    if (path.startsWith('/api/v1/')) return true;
    if (path === '/api/version') return true;
    if (path === '/api/github/latest') return true;
    if (path === '/api/config') return true;
    if (path === '/api-docs/swagger.json') return true;
    if (path === '/api/health') return true;
    if (path.startsWith('/api/admin/') && method === 'GET') {
        // Most admin GET endpoints are public for status/monitoring
        const publicAdminPaths = [
            '/api/admin/status',
            '/api/admin/update-check',
            '/api/admin/plex-qualities-with-counts',
            '/api/admin/jellyfin-qualities-with-counts',
            '/api/admin/rating-cache/stats',
        ];
        if (publicAdminPaths.includes(path)) return true;
    }

    return false;
};
console.log('\n🔧 Fixing warnings...\n');

// Process each endpoint
Object.entries(spec.paths || {}).forEach(([endpointPath, pathItem]) => {
    Object.entries(pathItem).forEach(([method, operation]) => {
        if (typeof operation !== 'object' || !operation) return;

        const methodUpper = method.toUpperCase();
        const endpointKey = `${methodUpper} ${endpointPath}`;

        // Fix missing 200 responses
        if (operation.responses && !operation.responses['200']) {
            // Determine appropriate 200 response based on endpoint type
            let response200;

            // Frontend/HTML pages
            if (
                endpointPath.includes('.html') ||
                ['/', '/admin', '/screensaver', '/wallart', '/cinema', '/preview'].includes(
                    endpointPath
                )
            ) {
                response200 = {
                    description: 'HTML page served successfully',
                    content: {
                        'text/html': {
                            schema: {
                                type: 'string',
                            },
                            example: '<!DOCTYPE html><html>...</html>',
                        },
                    },
                };
            }
            // API endpoints that might have JSON responses
            else if (endpointPath.startsWith('/api/')) {
                response200 = {
                    description: 'Successful operation',
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                            },
                            example: { success: true },
                        },
                    },
                };
            }
            // Other endpoints (downloads, etc.)
            else {
                response200 = {
                    description: 'Successful operation',
                };
            }

            // Add 200 response
            operation.responses['200'] = response200;
            console.log(`✅ Added 200 response: ${endpointKey}`);
            response200Count++;
            fixedCount++;
        }

        // Fix operations without any responses object
        if (!operation.responses) {
            operation.responses = {
                200: {
                    description: 'Successful operation',
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                            },
                            example: { success: true },
                        },
                    },
                },
            };
            console.log(`✅ Added responses object: ${endpointKey}`);
            response200Count++;
            fixedCount++;
        }

        // Fix missing examples in existing responses
        if (operation.responses && operation.responses['200']) {
            const response = operation.responses['200'];
            if (response.content) {
                Object.entries(response.content).forEach(([contentType, contentSpec]) => {
                    if (!contentSpec.example && !contentSpec.examples) {
                        // Add appropriate example based on content type
                        if (contentType === 'application/json') {
                            contentSpec.example = { success: true };
                        } else if (contentType === 'text/html') {
                            contentSpec.example = '<!DOCTYPE html><html>...</html>';
                        } else if (contentType.startsWith('image/')) {
                            contentSpec.example = '<binary data>';
                        } else if (contentType === 'text/plain') {
                            contentSpec.example = 'OK';
                        }
                        exampleCount++;
                        fixedCount++;
                    }
                });
            }
        }

        // Fix missing security definitions for public endpoints
        if (!operation.security && isPublicEndpoint(methodUpper, endpointPath)) {
            operation.security = [];
            console.log(`🔓 Added public security: ${endpointKey}`);
            securityCount++;
            fixedCount++;
        }
    });
});

// Write updated spec
console.log(`\n💾 Writing updated spec...`);
fs.writeFileSync(specPath, JSON.stringify(spec, null, 4), 'utf8');

console.log(`\n✅ Fixed ${fixedCount} issues!`);
console.log(`   - Added ${response200Count} missing 200 responses`);
console.log(`   - Added ${exampleCount} missing examples`);
console.log(`   - Added ${securityCount} security definitions`);
console.log('\n🧪 Run npm run openapi:validate to verify');
