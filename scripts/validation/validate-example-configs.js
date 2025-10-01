#!/usr/bin/env node

// Validate and suggest updates for config.example.env and config.example.json
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
const warnings = 0;
let suggestions = 0;

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

function findEnvUsageInCode() {
    // Look for process.env usage in server.js and other key files
    const filesToCheck = ['server.js', 'config/index.js', 'config/validate-env.js'];
    const envVars = new Set();

    filesToCheck.forEach(file => {
        if (fs.existsSync(file)) {
            const content = fs.readFileSync(file, 'utf8');

            // Find process.env.VARIABLE_NAME patterns
            const matches = content.match(/process\.env\.([A-Z_][A-Z0-9_]*)/g);
            if (matches) {
                matches.forEach(match => {
                    const varName = match.replace('process.env.', '');
                    envVars.add(varName);
                });
            }
        }
    });

    return Array.from(envVars);
}

function validateExampleEnv(exampleEnvFile) {
    log('blue', '🔍 Checking config.example.env completeness...');

    if (!fs.existsSync(exampleEnvFile)) {
        log('red', `❌ config.example.env not found`);
        errors++;
        return;
    }

    const content = fs.readFileSync(exampleEnvFile, 'utf8');
    const lines = content.split('\n');

    // Extract variable names from example env
    const exampleVars = new Set();
    lines.forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
            const [varName] = trimmed.split('=');
            if (varName) {
                exampleVars.add(varName);
            }
        }
    });

    // Find env vars used in code
    const codeVars = findEnvUsageInCode();

    // Check for missing variables in example
    const missingInExample = codeVars.filter(v => !exampleVars.has(v));
    if (missingInExample.length > 0) {
        log('yellow', `⚠️  Environment variables used in code but missing from example:`);
        missingInExample.forEach(varName => {
            log('yellow', `   - ${varName}`);
        });
        suggestions++;
    }

    // Check for unused variables in example
    const unusedInExample = Array.from(exampleVars).filter(v => !codeVars.includes(v));
    if (unusedInExample.length > 0) {
        log('blue', `ℹ️  Environment variables in example but not found in main code:`);
        unusedInExample.forEach(varName => {
            log('blue', `   - ${varName} (may be used in other files or be optional)`);
        });
    }

    if (missingInExample.length === 0) {
        log('green', '✅ config.example.env covers all detected environment variables');
    }
}

function validateExampleConfig(configFile, exampleFile, schemaFile) {
    log('blue', '🔍 Checking config.example.json structure...');

    const config = loadJSONFile(configFile, 'Current config');
    const example = loadJSONFile(exampleFile, 'Example config');
    const schema = loadJSONFile(schemaFile, 'Config schema');

    if (!config || !example) return;

    // Check if example has the same structure as current config
    function compareStructure(obj1, obj2, path = '') {
        const missing = [];
        const extra = [];

        // Check for missing keys
        for (const key in obj1) {
            if (Object.prototype.hasOwnProperty.call(obj1, key)) {
                const fullPath = path ? `${path}.${key}` : key;

                if (!(key in obj2)) {
                    missing.push(fullPath);
                } else if (
                    typeof obj1[key] === 'object' &&
                    obj1[key] !== null &&
                    typeof obj2[key] === 'object' &&
                    obj2[key] !== null &&
                    !Array.isArray(obj1[key]) &&
                    !Array.isArray(obj2[key])
                ) {
                    const [subMissing, subExtra] = compareStructure(obj1[key], obj2[key], fullPath);
                    missing.push(...subMissing);
                    extra.push(...subExtra);
                }
            }
        }

        // Check for extra keys
        for (const key in obj2) {
            if (Object.prototype.hasOwnProperty.call(obj2, key) && !(key in obj1)) {
                const fullPath = path ? `${path}.${key}` : key;
                extra.push(fullPath);
            }
        }

        return [missing, extra];
    }

    const [missingInExample, extraInExample] = compareStructure(config, example);

    if (missingInExample.length > 0) {
        log('yellow', `⚠️  Properties in config.json but missing from example:`);
        missingInExample.forEach(prop => {
            log('yellow', `   - ${prop}`);
        });
        suggestions++;
    }

    if (extraInExample.length > 0) {
        log('blue', `ℹ️  Properties in example but not in current config:`);
        extraInExample.forEach(prop => {
            log('blue', `   - ${prop} (may be deprecated or conditional)`);
        });
    }

    // Check if example follows schema defaults
    if (schema && schema.properties) {
        log('blue', '🔍 Checking if example uses recommended defaults...');
        checkDefaults(example, schema.properties);
    }

    if (missingInExample.length === 0) {
        log('green', '✅ config.example.json structure matches current config');
    }
}

function getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => current?.[key], obj);
}

function checkDefaults(exampleObj, schemaProps, path = '') {
    for (const [key, schemaProp] of Object.entries(schemaProps)) {
        if ('default' in schemaProp) {
            const fullPath = path ? `${path}.${key}` : key;
            const exampleValue = getNestedValue(exampleObj, fullPath);

            if (
                exampleValue !== undefined &&
                JSON.stringify(exampleValue) !== JSON.stringify(schemaProp.default)
            ) {
                log(
                    'blue',
                    `ℹ️  ${fullPath}: Example uses custom value (${JSON.stringify(exampleValue)}) instead of schema default (${JSON.stringify(schemaProp.default)})`
                );
            }
        }

        if (schemaProp.type === 'object' && schemaProp.properties) {
            checkDefaults(exampleObj, schemaProp.properties, path ? `${path}.${key}` : key);
        }
    }
}

function suggestUpdates() {
    if (suggestions > 0) {
        log('blue', '\n💡 Suggested Actions:');
        log('blue', '1. Review missing environment variables and add them to config.example.env');
        log('blue', '2. Update config.example.json to match current config.json structure');
        log('blue', '3. Consider if schema defaults should be updated to match example values');
    }
}

// Main validation
console.log('🔍 Validating example configuration files...\n');

validateExampleEnv('config.example.env');
validateExampleConfig('config.json', 'config.example.json', 'config.schema.json');

suggestUpdates();

// Summary
console.log('\n📊 Example Files Validation Summary:');
if (errors === 0 && suggestions === 0) {
    log('green', '✅ All example configuration files are up-to-date');
    process.exit(0);
} else {
    if (errors > 0) {
        log('red', `❌ ${errors} error(s) found`);
    }
    if (suggestions > 0) {
        log('yellow', `💡 ${suggestions} improvement(s) suggested`);
    }
    if (warnings > 0) {
        log('yellow', `⚠️  ${warnings} warning(s) found`);
    }
    process.exit(errors > 0 ? 1 : 0);
}
