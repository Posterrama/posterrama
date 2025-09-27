#!/usr/bin/env node
// Export current swagger specification to a JSON file.
const fs = require('fs');
const path = require('path');
const swagger = require('../swagger');

(async () => {
    try {
        const spec = swagger && swagger.generate ? swagger.generate() : swagger;
        const outDir = path.join(__dirname, '..', 'docs');
        const outFile = path.join(outDir, 'openapi-latest.json');
        await fs.promises.mkdir(outDir, { recursive: true });
        await fs.promises.writeFile(outFile, JSON.stringify(spec, null, 2));
        console.log('OpenAPI spec written to', outFile);
    } catch (e) {
        console.error('Failed to export OpenAPI spec:', e);
        process.exit(1);
    }
})();
