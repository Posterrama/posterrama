#!/usr/bin/env node

/**
 * API Documentation Completeness Verification Script
 * This script analyzes the server.js file and swagger.js configuration
 * to identify missing documentation and inconsistencies.
 */

const fs = require('fs');

console.log('🔍 API Documentation Completeness Verification\n');

// Read server.js file
const serverContent = fs.readFileSync('./server.js', 'utf8');

// Extract all HTTP routes from server.js
function extractRoutes(content) {
    const routes = [];
    const routeRegex = /app\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g;
    let match;

    while ((match = routeRegex.exec(content)) !== null) {
        const method = match[1].toUpperCase();
        const path = match[2];
        routes.push({ method, path });
    }

    return routes.sort((a, b) => a.path.localeCompare(b.path));
}

// Extract JSDoc/Swagger comments
function extractSwaggerDocs(content) {
    const docs = [];
    const swaggerRegex =
        /\/\*\*[\s\S]*?@swagger[\s\S]*?\*\/[\s]*app\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g;
    let match;

    while ((match = swaggerRegex.exec(content)) !== null) {
        const method = match[1].toUpperCase();
        const path = match[2];
        docs.push({ method, path });
    }

    return docs;
}

// Get all routes
const allRoutes = extractRoutes(serverContent);
const documentedRoutes = extractSwaggerDocs(serverContent);

// Categorize routes
const publicRoutes = allRoutes.filter(
    r =>
        !r.path.includes('/admin') &&
        !r.path.startsWith('/api/admin') &&
        !r.path.startsWith('/api/v1/admin') &&
        !r.path.includes('/setup') &&
        !r.path.includes('/login') &&
        !r.path.includes('/logout')
);

const adminRoutes = allRoutes.filter(
    r =>
        r.path.includes('/admin') ||
        r.path.startsWith('/api/admin') ||
        r.path.startsWith('/api/v1/admin')
);

const authRoutes = allRoutes.filter(
    r =>
        r.path.includes('/auth') ||
        r.path.includes('/login') ||
        r.path.includes('/logout') ||
        r.path.includes('/setup') ||
        r.path.includes('/2fa')
);

const apiV1Routes = allRoutes.filter(r => r.path.startsWith('/api/v1/'));

console.log('📊 ROUTE ANALYSIS');
console.log('═'.repeat(50));
console.log(`Total Routes Found: ${allRoutes.length}`);
console.log(`Public API Routes: ${publicRoutes.length}`);
console.log(`Admin Routes: ${adminRoutes.length}`);
console.log(`Auth Routes: ${authRoutes.length}`);
console.log(`API v1 Routes: ${apiV1Routes.length}`);
console.log(`Documented Routes: ${documentedRoutes.length}`);
console.log('');

// Find undocumented routes
const documentedPaths = new Set(documentedRoutes.map(r => `${r.method} ${r.path}`));
const undocumentedRoutes = allRoutes.filter(r => !documentedPaths.has(`${r.method} ${r.path}`));

console.log('❌ UNDOCUMENTED ROUTES');
console.log('═'.repeat(50));
if (undocumentedRoutes.length === 0) {
    console.log('✅ All routes are documented!');
} else {
    console.log('The following routes lack JSDoc/Swagger documentation:');
    undocumentedRoutes.forEach(route => {
        const category = route.path.includes('/admin')
            ? '[ADMIN]'
            : route.path.includes('/auth')
              ? '[AUTH]'
              : route.path.startsWith('/api/v1/')
                ? '[API-V1]'
                : '[PUBLIC]';
        console.log(`  ${category} ${route.method} ${route.path}`);
    });
}
console.log(`\nUndocumented: ${undocumentedRoutes.length}/${allRoutes.length} routes\n`);

// Analyze key public API endpoints
console.log('🔑 KEY PUBLIC API ENDPOINTS');
console.log('═'.repeat(50));
const keyEndpoints = [
    'GET /get-config',
    'GET /get-media',
    'GET /get-media-by-key/:key',
    'GET /image',
    'GET /health',
    'GET /api/health',
    'GET /api/v1/config',
    'GET /api/v1/media',
];

keyEndpoints.forEach(endpoint => {
    const [method, path] = endpoint.split(' ');
    const exists = allRoutes.some(r => r.method === method && r.path === path);
    const documented = documentedPaths.has(endpoint);

    console.log(`  ${exists ? '✅' : '❌'} ${documented ? '📚' : '📝'} ${endpoint}`);
    if (exists && !documented) {
        console.log(`    ⚠️  Route exists but lacks documentation`);
    }
    if (!exists) {
        console.log(`    ⚠️  Route not found in implementation`);
    }
});

console.log('\nLegend: ✅ = exists, ❌ = missing, 📚 = documented, 📝 = undocumented\n');

// Check for v1 API aliases
console.log('🔄 API VERSION ALIASES');
console.log('═'.repeat(50));
const aliasChecks = [
    { alias: '/api/v1/config', target: '/get-config' },
    { alias: '/api/v1/media', target: '/get-media' },
];

aliasChecks.forEach(({ alias, target }) => {
    const aliasExists =
        serverContent.includes(`'${alias}'`) || serverContent.includes(`"${alias}"`);
    const targetExists = allRoutes.some(r => r.path === target);
    console.log(
        `  ${aliasExists ? '✅' : '❌'} ${alias} → ${target} ${targetExists ? '(target exists)' : '(target missing)'}`
    );
});

// Check swagger.js configuration
console.log('\n⚙️  SWAGGER CONFIGURATION');
console.log('═'.repeat(50));
try {
    const swaggerConfig = require('./swagger.js');
    console.log('✅ swagger.js loads successfully');
    console.log(`✅ OpenAPI version: ${swaggerConfig.openapi}`);
    console.log(`✅ Title: ${swaggerConfig.info?.title}`);
    console.log(`✅ Version: ${swaggerConfig.info?.version}`);

    if (swaggerConfig.paths) {
        console.log(`✅ Manual path definitions: ${Object.keys(swaggerConfig.paths).length}`);
        Object.keys(swaggerConfig.paths).forEach(path => {
            console.log(`    - ${path}`);
        });
    } else {
        console.log('ℹ️  No manual path definitions (using JSDoc auto-generation)');
    }
} catch (error) {
    console.log('❌ Error loading swagger.js:', error.message);
}

// Documentation coverage recommendations
console.log('\n💡 RECOMMENDATIONS');
console.log('═'.repeat(50));

const priorityUndocumented = undocumentedRoutes.filter(
    r =>
        publicRoutes.some(p => p.method === r.method && p.path === r.path) ||
        r.path.startsWith('/api/v1/')
);

if (priorityUndocumented.length > 0) {
    console.log('🎯 HIGH PRIORITY - Add documentation for these public API endpoints:');
    priorityUndocumented.forEach(route => {
        console.log(`   - ${route.method} ${route.path}`);
    });
    console.log('');
}

if (undocumentedRoutes.filter(r => r.path.includes('/admin')).length > 0) {
    console.log('🔧 MEDIUM PRIORITY - Document admin endpoints:');
    undocumentedRoutes
        .filter(r => r.path.includes('/admin'))
        .forEach(route => {
            console.log(`   - ${route.method} ${route.path}`);
        });
    console.log('');
}

// Find documented routes that don't have corresponding endpoints (unused docs)
const actualPaths = new Set(allRoutes.map(r => `${r.method} ${r.path}`));
const unusedDocs = documentedRoutes.filter(r => !actualPaths.has(`${r.method} ${r.path}`));

console.log('🧹 UNUSED SWAGGER DOCUMENTATION');
console.log('═'.repeat(50));
if (unusedDocs.length === 0) {
    console.log(
        '✅ No unused documentation found! All Swagger docs correspond to actual endpoints.'
    );
} else {
    console.log('The following Swagger documentation refers to non-existent endpoints:');
    unusedDocs.forEach(doc => {
        console.log(`  � ${doc.method} ${doc.path}`);
    });
    console.log(`\nUnused docs: ${unusedDocs.length}`);
    console.log('💡 Consider removing these unused Swagger comments to keep docs clean.');
}
console.log('');

console.log('�📋 VERIFICATION CHECKLIST:');
console.log('  □ Start server and visit /api-docs to verify Swagger UI');
console.log('  □ Test key endpoints: /get-config, /get-media, /api/v1/config');
console.log('  □ Verify response schemas match actual API responses');
console.log('  □ Check that error responses are documented');
console.log('  □ Validate authentication requirements are correct');
console.log('  □ Test API v1 aliases work as expected');
console.log('  □ Remove unused Swagger documentation identified above');

console.log('\n✨ DOCUMENTATION COMPLETENESS SUMMARY');
console.log('═'.repeat(50));
const completeness = Math.round((documentedRoutes.length / allRoutes.length) * 100);
console.log(
    `Overall Documentation Coverage: ${completeness}% (${documentedRoutes.length}/${allRoutes.length})`
);
console.log(`Unused Documentation: ${unusedDocs.length} orphaned Swagger comments`);

if (completeness >= 90) {
    console.log('🎉 Excellent! Your API documentation is very comprehensive.');
} else if (completeness >= 75) {
    console.log('👍 Good coverage, but consider documenting remaining endpoints.');
} else if (completeness >= 50) {
    console.log('⚠️  Moderate coverage. Focus on documenting public API endpoints first.');
} else {
    console.log('🚨 Low coverage. Prioritize documenting key public endpoints.');
}

if (unusedDocs.length === 0) {
    console.log('🧹 Clean! No unused Swagger documentation found.');
}
