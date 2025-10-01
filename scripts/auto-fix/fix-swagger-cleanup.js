#!/usr/bin/env node

// Auto-fix Swagger documentation by removing unused endpoints
const fs = require('fs');

// Color codes
const colors = {
    red: '\x1b[0;31m',
    green: '\x1b[0;32m',
    yellow: '\x1b[1;33m',
    blue: '\x1b[0;34m',
    nc: '\x1b[0m',
};

function log(level, message) {
    const color = colors[level] || colors.nc;
    console.log(`${color}${message}${colors.nc}`);
}

let fixed = 0;
let errors = 0;

function extractRoutes(serverFilePath) {
    if (!fs.existsSync(serverFilePath)) {
        return [];
    }

    const content = fs.readFileSync(serverFilePath, 'utf8');
    const routes = [];

    // Match router method calls like app.get('/path', ...) or router.post('/api/path', ...)
    const routePattern =
        /(?:app|router)\.(get|post|put|patch|delete|use)\s*\(\s*['"`]([^'"`]+)['"`]/g;
    let match;

    while ((match = routePattern.exec(content)) !== null) {
        const [, method, path] = match;
        if (method !== 'use' || path.startsWith('/')) {
            // Skip middleware unless it's a path-specific middleware
            routes.push({
                method: method.toLowerCase(),
                path: path,
            });
        }
    }

    return routes;
}

function extractSwaggerDocs(swaggerFilePath) {
    if (!fs.existsSync(swaggerFilePath)) {
        return {};
    }

    const content = fs.readFileSync(swaggerFilePath, 'utf8');

    try {
        // Find the swaggerSpec definition
        const specMatch = content.match(/const swaggerSpec = ({[\s\S]*?});/);
        if (!specMatch) {
            return {};
        }

        // Use eval to parse the JavaScript object (safer than eval in this controlled context)
        const specString = specMatch[1];
        const spec = eval(`(${specString})`);

        return spec.paths || {};
    } catch (e) {
        log('yellow', `⚠️  Could not parse swagger spec: ${e.message}`);
        return {};
    }
}

function removeUnusedSwaggerEndpoints() {
    log('blue', '🔧 Auto-fixing Swagger documentation...');

    const routes = extractRoutes('server.js');
    const swaggerFilePath = 'swagger.js';

    if (!fs.existsSync(swaggerFilePath)) {
        log('yellow', '⚠️  swagger.js not found - skipping');
        return;
    }

    let content = fs.readFileSync(swaggerFilePath, 'utf8');
    const originalContent = content;

    try {
        const swaggerDocs = extractSwaggerDocs(swaggerFilePath);
        const actualPaths = new Set(routes.map(r => r.path));
        const documentedPaths = Object.keys(swaggerDocs);

        log(
            'blue',
            `Found ${routes.length} actual routes and ${documentedPaths.length} documented paths`
        );

        // Find unused documented paths
        const unusedPaths = documentedPaths.filter(path => {
            // Check if this documented path matches any actual route
            return (
                !actualPaths.has(path) &&
                !routes.some(route => {
                    // Handle parameterized routes like /api/media/:id matching /api/media/{id}
                    const swaggerPath = path.replace(/\{[^}]+\}/g, ':([^/]+)');
                    const routePath = route.path.replace(/:([^/]+)/g, '{$1}');
                    return routePath === path || new RegExp(`^${swaggerPath}$`).test(route.path);
                })
            );
        });

        if (unusedPaths.length === 0) {
            log('green', '✅ No unused Swagger endpoints found');
            return;
        }

        log('yellow', `Found ${unusedPaths.length} unused documented paths:`);
        unusedPaths.forEach(path => log('yellow', `   - ${path}`));

        // Remove unused paths from swagger spec
        unusedPaths.forEach(unusedPath => {
            // Create a regex to match the path and its entire definition
            const escapedPath = unusedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const pathRegex = new RegExp(
                `\\s*['"\`]${escapedPath}['"\`]\\s*:\\s*{[\\s\\S]*?(?=\\s*['"\`][^'"\`]*['"\`]\\s*:|\\s*}\\s*(?:,\\s*)?$)`,
                'g'
            );

            const beforeRemoval = content;
            content = content.replace(pathRegex, '');

            if (content !== beforeRemoval) {
                log('green', `✅ Removed unused endpoint: ${unusedPath}`);
                fixed++;
            }
        });

        // Clean up any trailing commas or formatting issues
        content = content.replace(/,(\s*})/g, '$1'); // Remove trailing commas before }
        content = content.replace(/{\s*,/g, '{'); // Remove leading commas after {
        content = content.replace(/,\s*,/g, ','); // Remove double commas

        if (content !== originalContent) {
            fs.writeFileSync(swaggerFilePath, content);
            log('green', '✅ swagger.js cleaned up');
        }
    } catch (e) {
        log('red', `❌ Error processing swagger.js: ${e.message}`);
        errors++;
    }
}

// Main execution
async function main() {
    log('blue', '🔧 Auto-fixing Swagger documentation...\n');

    removeUnusedSwaggerEndpoints();

    console.log('\n📊 Swagger Auto-fix Summary:');
    if (fixed > 0) {
        log('green', `✅ ${fixed} unused endpoints removed`);
    }
    if (errors > 0) {
        log('red', `❌ ${errors} errors occurred`);
    }

    if (errors === 0) {
        log('green', '✅ Swagger documentation is now clean');
        process.exit(0);
    } else {
        log('yellow', '⚠️  Some issues could not be auto-fixed - manual intervention needed');
        process.exit(1);
    }
}

main().catch(e => {
    log('red', `❌ Unexpected error: ${e.message}`);
    process.exit(1);
});
