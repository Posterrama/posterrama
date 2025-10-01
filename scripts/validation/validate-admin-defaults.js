#!/usr/bin/env node

// Validate admin defaults for new installations
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

function checkFile(filename, description) {
    if (!fs.existsSync(filename)) {
        log('red', `❌ ${description}: File missing (${filename})`);
        errors++;
        return null;
    }
    return filename;
}

function validateJSON(filename) {
    try {
        const content = fs.readFileSync(filename, 'utf8');
        return JSON.parse(content);
    } catch (e) {
        log('red', `❌ ${filename}: Invalid JSON - ${e.message}`);
        errors++;
        return null;
    }
}

function validateEnvDefaults(filename) {
    const content = fs.readFileSync(filename, 'utf8');
    const lines = content.split('\n');

    // Check for placeholder values that need attention
    const problematicPatterns = [
        { pattern: /=TODO/, message: 'Contains TODO placeholder' },
        { pattern: /=CHANGE_ME/, message: 'Contains CHANGE_ME placeholder' },
        { pattern: /=your_/, message: 'Contains your_ placeholder' },
        { pattern: /=REPLACE_/, message: 'Contains REPLACE_ placeholder' },
        { pattern: /=xxx/i, message: 'Contains xxx placeholder' },
    ];

    const issues = [];
    lines.forEach((line, index) => {
        problematicPatterns.forEach(({ pattern, message }) => {
            if (pattern.test(line) && !line.trim().startsWith('#')) {
                issues.push(`Line ${index + 1}: ${message} - ${line.trim()}`);
            }
        });
    });

    if (issues.length > 0) {
        log('yellow', `⚠️  ${filename}: Potential placeholder values:`);
        issues.forEach(issue => log('yellow', `   ${issue}`));
        warnings += issues.length;
    }

    // Check for essential variables
    const essentialVars = ['NODE_ENV', 'DEBUG', 'SERVER_PORT'];
    const missingVars = essentialVars.filter(varName => {
        return !lines.some(
            line => line.startsWith(`${varName}=`) || line.startsWith(`# ${varName}=`)
        );
    });

    if (missingVars.length > 0) {
        log('red', `❌ ${filename}: Missing essential variables: ${missingVars.join(', ')}`);
        errors++;
    }
}

function validateConfigDefaults(config) {
    const checks = [
        {
            path: 'transitionIntervalSeconds',
            validate: v => typeof v === 'number' && v >= 5,
            message: 'transitionIntervalSeconds should be number >= 5',
        },
        {
            path: 'backgroundRefreshMinutes',
            validate: v => typeof v === 'number' && v >= 5,
            message: 'backgroundRefreshMinutes should be number >= 5',
        },
        {
            path: 'showPoster',
            validate: v => typeof v === 'boolean',
            message: 'showPoster should be boolean',
        },
        {
            path: 'showMetadata',
            validate: v => typeof v === 'boolean',
            message: 'showMetadata should be boolean',
        },
    ];

    checks.forEach(({ path, validate, message }) => {
        const value = getNestedValue(config, path);
        if (value === undefined) {
            log('yellow', `⚠️  config.example.json: Missing recommended default: ${path}`);
            warnings++;
        } else if (!validate(value)) {
            log('red', `❌ config.example.json: Invalid default: ${message} (got: ${value})`);
            errors++;
        }
    });
}

function getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => current?.[key], obj);
}

function validateAgainstSchema(config, schemaFile) {
    // Simple schema validation - check if required fields exist
    const schema = validateJSON(schemaFile);
    if (!schema) return;

    const required = schema.required || [];
    const missing = required.filter(field => !(field in config));

    if (missing.length > 0) {
        log('red', `❌ config.example.json: Missing required fields: ${missing.join(', ')}`);
        errors++;
    }
}

// Main validation
console.log('🔍 Validating admin defaults for new installations...\n');

// Check if files exist
const configExampleFile = checkFile('config.example.json', 'Example config');
const envExampleFile = checkFile('config.example.env', 'Example environment');
const schemaFile = checkFile('config.schema.json', 'Config schema');

if (!configExampleFile || !envExampleFile) {
    process.exit(1);
}

// Validate config.example.json
const config = validateJSON(configExampleFile);
if (config) {
    log('green', '✅ config.example.json: Valid JSON');
    validateConfigDefaults(config);

    if (schemaFile) {
        validateAgainstSchema(config, schemaFile);
    }
}

// Validate config.example.env
validateEnvDefaults(envExampleFile);

// Summary
console.log('\n📊 Validation Summary:');
if (errors === 0 && warnings === 0) {
    log('green', '✅ All admin defaults are suitable for new installations');
    process.exit(0);
} else {
    if (errors > 0) {
        log('red', `❌ ${errors} error(s) found - admin defaults need attention`);
    }
    if (warnings > 0) {
        log('yellow', `⚠️  ${warnings} warning(s) found - consider reviewing`);
    }
    process.exit(errors > 0 ? 1 : 0);
}
