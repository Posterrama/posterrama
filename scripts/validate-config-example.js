#!/usr/bin/env node
/**
 * Validates config.example.json against config.schema.json using Ajv.
 * Fails (exit code 1) on any schema validation errors or unknown properties.
 * Provides a concise summary plus detailed error listing.
 */
const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

const schemaPath = path.join(__dirname, '..', 'config.schema.json');
const examplePath = path.join(__dirname, '..', 'config.example.json');

function loadJson(p) {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function main() {
    let schema, example;
    try {
        schema = loadJson(schemaPath);
    } catch (e) {
        console.error('[config-validate] Failed to read schema:', e.message);
        process.exit(2);
    }
    try {
        example = loadJson(examplePath);
    } catch (e) {
        console.error('[config-validate] Failed to read example config:', e.message);
        process.exit(2);
    }

    const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
    const validate = ajv.compile(schema);
    const valid = validate(example);

    if (valid) {
        console.log('[config-validate] config.example.json is valid against config.schema.json');
        process.exit(0);
    }

    console.error('[config-validate] Validation FAILED. Issues:');
    for (const err of validate.errors) {
        console.error(`  - ${err.instancePath || '(root)'} ${err.message}`);
    }
    process.exit(1);
}

if (require.main === module) {
    main();
}
