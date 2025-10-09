#!/usr/bin/env node

// Validate if config.schema.json is up-to-date with current config files
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

let errors = 0;
let warnings = 0;

function loadJSONFile(filename, description) {
    if (!fs.existsSync(filename)) {
        log('red', `❌ ${description}: File missing (${filename})`);
        errors++;
        return null;
    }

    try {
        const content = fs.readFileSync(filename, 'utf8');
        return JSON.parse(content);
    } catch (e) {
        log('red', `❌ ${description}: Invalid JSON - ${e.message}`);
        errors++;
        return null;
    }
}

function getAllKeys(obj, prefix = '') {
    const keys = [];

    for (const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        keys.push(fullKey);

        if (value && typeof value === 'object' && !Array.isArray(value)) {
            keys.push(...getAllKeys(value, fullKey));
        }
    }

    return keys;
}

function getSchemaKeys(schema, prefix = '') {
    const keys = [];

    if (schema.properties) {
        for (const [key, value] of Object.entries(schema.properties)) {
            const fullKey = prefix ? `${prefix}.${key}` : key;
            keys.push(fullKey);

            if (value.type === 'object' && value.properties) {
                keys.push(...getSchemaKeys(value, fullKey));
            }
        }
    }

    return keys;
}

function validateSchemaCompleteness(config, exampleConfig, schema) {
    log('blue', '🔍 Checking schema completeness...');

    // Get all keys from both config files
    const configKeys = getAllKeys(config);
    const exampleKeys = getAllKeys(exampleConfig);
    const allConfigKeys = [...new Set([...configKeys, ...exampleKeys])];

    // Get all keys from schema
    const schemaKeys = getSchemaKeys(schema);

    // Find keys in config but not in schema
    const missingInSchema = allConfigKeys.filter(key => !schemaKeys.includes(key));

    if (missingInSchema.length > 0) {
        log('red', `❌ Properties missing from schema:`);
        missingInSchema.forEach(key => {
            log('red', `   - ${key}`);
        });
        errors += missingInSchema.length;
    } else {
        log('green', '✅ All config properties are covered by schema');
    }

    // Find keys in schema but not used in configs
    const unusedInSchema = schemaKeys.filter(key => !allConfigKeys.includes(key));

    if (unusedInSchema.length > 0) {
        log('yellow', `⚠️  Schema properties not used in config files:`);
        unusedInSchema.forEach(key => {
            log('yellow', `   - ${key}`);
        });
        warnings += unusedInSchema.length;
    }
}

function validateDefaultValues(exampleConfig, schema) {
    log('blue', '🔍 Checking default values consistency...');

    function checkDefaults(obj, schemaProps, prefix = '') {
        for (const [key, value] of Object.entries(obj)) {
            const fullKey = prefix ? `${prefix}.${key}` : key;
            const schemaProp = schemaProps[key];

            if (schemaProp && 'default' in schemaProp) {
                if (JSON.stringify(value) !== JSON.stringify(schemaProp.default)) {
                    log('yellow', `⚠️  Default value mismatch for ${fullKey}:`);
                    log('yellow', `   Example: ${JSON.stringify(value)}`);
                    log('yellow', `   Schema: ${JSON.stringify(schemaProp.default)}`);
                    warnings++;
                }
            }

            if (
                value &&
                typeof value === 'object' &&
                !Array.isArray(value) &&
                schemaProp &&
                schemaProp.type === 'object' &&
                schemaProp.properties
            ) {
                checkDefaults(value, schemaProp.properties, fullKey);
            }
        }
    }

    if (schema.properties) {
        checkDefaults(exampleConfig, schema.properties);
    }
}

function validateRequiredFields(schema) {
    log('blue', '🔍 Checking required fields...');

    if (schema.required && schema.required.length > 0) {
        log(
            'green',
            `✅ Schema has ${schema.required.length} required fields: ${schema.required.join(', ')}`
        );
    } else {
        log('yellow', '⚠️  Schema has no required fields - consider if this is correct');
        warnings++;
    }
}

function validateSchemaStructure(schema) {
    log('blue', '🔍 Checking schema structure...');

    const requiredSchemaFields = ['$schema', 'type', 'properties'];
    const missingFields = requiredSchemaFields.filter(field => !(field in schema));

    if (missingFields.length > 0) {
        log('red', `❌ Schema missing required fields: ${missingFields.join(', ')}`);
        errors++;
    } else {
        log('green', '✅ Schema has proper structure');
    }

    if (schema.type !== 'object') {
        log('red', `❌ Schema root type should be 'object', got '${schema.type}'`);
        errors++;
    }
}

// Main validation
console.log('🔍 Validating config.schema.json completeness...\n');

// Load all files
const config = loadJSONFile('../config.json', 'Current config');
const exampleConfig = loadJSONFile('../config.example.json', 'Example config');
const schema = loadJSONFile('../config.schema.json', 'Config schema');

if (!config || !exampleConfig || !schema) {
    process.exit(1);
}

// Run validations
validateSchemaStructure(schema);
validateSchemaCompleteness(config, exampleConfig, schema);
validateDefaultValues(exampleConfig, schema);
validateRequiredFields(schema);

// Summary
console.log('\n📊 Schema Validation Summary:');
if (errors === 0 && warnings === 0) {
    log('green', '✅ config.schema.json is up-to-date and complete');
    process.exit(0);
} else {
    if (errors > 0) {
        log('red', `❌ ${errors} error(s) found - schema needs updates`);
    }
    if (warnings > 0) {
        log('yellow', `⚠️  ${warnings} warning(s) found - consider reviewing`);
    }
    process.exit(errors > 0 ? 1 : 0);
}
