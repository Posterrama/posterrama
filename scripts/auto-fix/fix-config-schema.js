#!/usr/bin/env node

// Auto-fix config.schema.json to keep it up-to-date
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

function getAllConfigProperties(obj, prefix = '') {
    const properties = {};

    for (const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;

        if (value && typeof value === 'object' && !Array.isArray(value)) {
            // Nested object
            properties[key] = {
                type: 'object',
                properties: getAllConfigProperties(value, fullKey),
            };
        } else {
            // Primitive value - infer schema
            properties[key] = inferSchemaProperty(value, key);
        }
    }

    return properties;
}

function inferSchemaProperty(value, key) {
    const property = {
        type: typeof value,
        default: value,
    };

    // Add descriptions based on key names
    const descriptions = {
        transitionIntervalSeconds: 'How many seconds each poster is visible.',
        backgroundRefreshMinutes: 'How often (in minutes) the entire media library is re-fetched.',
        showClearLogo: 'Shows the movie/series logo (if available).',
        showRottenTomatoes: 'Shows a Fresh or Rotten badge on the poster.',
        showPoster: 'Shows the poster.',
        showMetadata: 'Shows metadata information.',
        clockWidget: 'Enable the clock widget display.',
        enabled: 'Enable this feature.',
        url: 'The URL endpoint for this service.',
        apiKey: 'API key for authentication.',
        token: 'Authentication token.',
        port: 'Port number for the service.',
        timeout: 'Timeout in milliseconds.',
        retries: 'Number of retry attempts.',
        maxSize: 'Maximum size limit.',
        interval: 'Interval in seconds.',
        debug: 'Enable debug logging.',
    };

    if (descriptions[key]) {
        property.description = descriptions[key];
    }

    // Add constraints based on type and key
    if (typeof value === 'number') {
        if (key.includes('Seconds') || key.includes('Minutes') || key.includes('Interval')) {
            property.minimum = 1;
        }
        if (key.includes('Port')) {
            property.minimum = 1;
            property.maximum = 65535;
        }
        if (key.includes('Percent') || key.includes('Score')) {
            property.minimum = 0;
            property.maximum = 100;
        }
    }

    if (typeof value === 'string') {
        if (key.includes('url') || key.includes('Url') || key.includes('URL')) {
            property.format = 'uri';
        }
        if (key.includes('email') || key.includes('Email')) {
            property.format = 'email';
        }
    }

    return property;
}

function updateSchemaWithMissingProperties() {
    log('blue', '🔧 Auto-updating config.schema.json...');

    // Load files
    const config = loadJSONFile('config.json', 'Current config');
    const exampleConfig = loadJSONFile('config.example.json', 'Example config');
    const schema = loadJSONFile('config.schema.json', 'Config schema');

    if (!config || !exampleConfig || !schema) {
        return;
    }

    // Merge config and example to get all possible properties
    const allConfigProps = { ...config, ...exampleConfig };
    const newSchemaProps = getAllConfigProperties(allConfigProps);

    // Check what's missing from current schema
    let modified = false;

    function addMissingToSchema(newProps, currentProps, path = '') {
        for (const [key, newProp] of Object.entries(newProps)) {
            const fullPath = path ? `${path}.${key}` : key;

            if (!currentProps[key]) {
                currentProps[key] = newProp;
                log('green', `✅ Added missing schema property: ${fullPath}`);
                modified = true;
                fixed++;
            } else if (
                newProp.type === 'object' &&
                newProp.properties &&
                currentProps[key].type === 'object' &&
                currentProps[key].properties
            ) {
                addMissingToSchema(newProp.properties, currentProps[key].properties, fullPath);
            }
        }
    }

    if (schema.properties) {
        addMissingToSchema(newSchemaProps, schema.properties);
    } else {
        schema.properties = newSchemaProps;
        log('green', '✅ Added complete properties section to schema');
        modified = true;
        fixed++;
    }

    // Update default values that don't match
    function updateDefaults(configObj, schemaProps, path = '') {
        for (const [key, value] of Object.entries(configObj)) {
            const fullPath = path ? `${path}.${key}` : key;

            if (schemaProps[key] && 'default' in schemaProps[key]) {
                if (JSON.stringify(schemaProps[key].default) !== JSON.stringify(value)) {
                    log(
                        'blue',
                        `🔄 Updating default value for ${fullPath}: ${JSON.stringify(schemaProps[key].default)} → ${JSON.stringify(value)}`
                    );
                    schemaProps[key].default = value;
                    modified = true;
                    fixed++;
                }
            }

            if (
                value &&
                typeof value === 'object' &&
                !Array.isArray(value) &&
                schemaProps[key] &&
                schemaProps[key].properties
            ) {
                updateDefaults(value, schemaProps[key].properties, fullPath);
            }
        }
    }

    // Update defaults based on current config
    if (schema.properties) {
        updateDefaults(config, schema.properties);
    }

    if (modified) {
        // Write updated schema
        fs.writeFileSync('config.schema.json', JSON.stringify(schema, null, 4));
        log(
            'green',
            '✅ config.schema.json updated with missing properties and corrected defaults'
        );
    } else {
        log('green', '✅ config.schema.json is already up-to-date');
    }
}

// Main execution
async function main() {
    log('blue', '🔧 Auto-fixing config.schema.json...\n');

    updateSchemaWithMissingProperties();

    console.log('\n📊 Config Schema Auto-fix Summary:');
    if (fixed > 0) {
        log('green', `✅ ${fixed} schema updates applied`);
    }
    if (errors > 0) {
        log('red', `❌ ${errors} errors occurred`);
    }

    if (errors === 0) {
        log('green', '✅ Config schema is now up-to-date');
        process.exit(0);
    } else {
        log('yellow', '⚠️  Some schema updates could not be applied - manual intervention needed');
        process.exit(1);
    }
}

main().catch(e => {
    log('red', `❌ Unexpected error: ${e.message}`);
    process.exit(1);
});
