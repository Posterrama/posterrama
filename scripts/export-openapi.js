#!/usr/bin/env node

/**
 * Export OpenAPI Specification
 *
 * Exports the current swagger.js specification to docs/openapi-latest.json
 * This ensures the static JSON file stays in sync with the live spec.
 *
 * Usage:
 *   node scripts/export-openapi.js
 *   npm run openapi:export
 */

const fs = require('fs');
const path = require('path');
const prettier = require('prettier');

// Force fresh require of swagger.js
delete require.cache[require.resolve('../swagger.js')];
const swagger = require('../swagger');

(async () => {
    try {
        // Generate fresh spec
        const spec = swagger && swagger.generate ? swagger.generate() : swagger;

        // Ensure output directory exists
        const outDir = path.join(__dirname, '..', 'docs');
        const outFile = path.join(outDir, 'openapi-latest.json');

        await fs.promises.mkdir(outDir, { recursive: true });

        // Keep formatting stable to avoid noisy diffs.
        // Prettier's JSON printer behaves slightly differently depending on input formatting,
        // so feed it a consistently-indented string first.
        const prettierConfig = (await prettier.resolveConfig(outFile)) || {};
        let output = await prettier.format(JSON.stringify(spec, null, 4), {
            ...prettierConfig,
            parser: 'json',
        });
        if (!output.endsWith('\n')) {
            output += '\n';
        }
        await fs.promises.writeFile(outFile, output);

        console.log('✅ OpenAPI spec exported to', outFile);
        console.log(`📊 Endpoints: ${Object.keys(spec.paths || {}).length}`);
        console.log(`📝 Tags: ${(spec.tags || []).length}`);
        console.log(`🔧 Version: ${spec.info.version}`);
    } catch (e) {
        console.error('❌ Failed to export OpenAPI spec:', e);
        process.exit(1);
    }
})();
