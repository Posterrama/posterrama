#!/usr/bin/env node

/**
 * Generate OpenAPI specification file
 * Extracts the Swagger spec and writes it to docs/openapi-latest.json
 */

const fs = require('fs');
const path = require('path');

// Ensure we're in the project root
const rootDir = path.resolve(__dirname, '..');
process.chdir(rootDir);

console.log('🔧 Generating OpenAPI specification...');

try {
    // Load swagger.js to generate the spec
    const swaggerSpec = require('../swagger.js');

    // Ensure docs directory exists
    const docsDir = path.join(rootDir, 'docs');
    if (!fs.existsSync(docsDir)) {
        fs.mkdirSync(docsDir, { recursive: true });
    }

    // Write the spec to docs/openapi-latest.json
    const outputPath = path.join(docsDir, 'openapi-latest.json');
    fs.writeFileSync(outputPath, JSON.stringify(swaggerSpec, null, 2), 'utf8');

    console.log(`✅ OpenAPI spec generated: ${outputPath}`);
    console.log(`   Version: ${swaggerSpec.info.version}`);
    console.log(`   Endpoints: ${Object.keys(swaggerSpec.paths || {}).length}`);

    process.exit(0);
} catch (error) {
    console.error('❌ Failed to generate OpenAPI spec:', error.message);
    process.exit(1);
}
