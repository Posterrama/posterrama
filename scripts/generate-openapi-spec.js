#!/usr/bin/env node

/**
 * Generate OpenAPI specification file
 * Extracts the Swagger spec and writes it to docs/openapi-latest.json
 */

const fs = require('fs');
const path = require('path');
const prettier = require('prettier');

// Ensure we're in the project root
const rootDir = path.resolve(__dirname, '..');
process.chdir(rootDir);

console.log('🔧 Generating OpenAPI specification...');

async function generateSpec() {
    try {
        // Load swagger.js to generate the spec
        const swaggerSpec = require('../swagger.js');

        // Ensure docs directory exists
        const docsDir = path.join(rootDir, 'docs');
        if (!fs.existsSync(docsDir)) {
            fs.mkdirSync(docsDir, { recursive: true });
        }

        // Load Prettier config from .prettierrc
        const prettierConfigPath = path.join(rootDir, '.prettierrc');
        const prettierConfig = JSON.parse(fs.readFileSync(prettierConfigPath, 'utf8'));

        // Convert to JSON with proper indentation (matching Prettier's tabWidth)
        const jsonContent = JSON.stringify(swaggerSpec, null, prettierConfig.tabWidth || 4);

        // Format with Prettier to ensure consistency
        const formattedContent = await prettier.format(jsonContent, {
            ...prettierConfig,
            parser: 'json',
        });

        // Write the formatted spec to docs/openapi-latest.json
        const outputPath = path.join(docsDir, 'openapi-latest.json');
        fs.writeFileSync(outputPath, formattedContent, 'utf8');

        console.log(`✅ OpenAPI spec generated: ${outputPath}`);
        console.log(`   Version: ${swaggerSpec.info.version}`);
        console.log(`   Endpoints: ${Object.keys(swaggerSpec.paths || {}).length}`);

        process.exit(0);
    } catch (error) {
        console.error('❌ Failed to generate OpenAPI spec:', error.message);
        process.exit(1);
    }
}

generateSpec();
