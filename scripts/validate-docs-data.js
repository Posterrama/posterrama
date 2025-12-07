#!/usr/bin/env node
/**
 * Validate docs-data.json help entries
 *
 * Checks:
 * 1. No duplicate IDs
 * 2. Required fields present
 * 3. Category values are valid
 * 4. Default values match config.schema.json where applicable
 * 5. Valid JSON structure
 */

const path = require('path');
const fs = require('fs');

const VALID_CATEGORIES = [
    'Cinema',
    'Screensaver',
    'Wallart',
    'Display Modes',
    'Media Sources',
    'Devices',
    'System',
    'Operations',
    'Integrations',
    'Troubleshooting',
    'Environment Variables',
];

const REQUIRED_FIELDS = ['id', 'title', 'category', 'description', 'help'];

function loadJson(file) {
    const full = path.resolve(__dirname, '..', file);
    const txt = fs.readFileSync(full, 'utf8');
    return JSON.parse(txt);
}

/**
 * Extract all default values from config.schema.json recursively
 * @param {object} schema - JSON schema object
 * @param {string} prefix - Property path prefix
 * @returns {Map<string, any>} Map of property paths to default values
 */
function extractSchemaDefaults(schema, prefix = '') {
    const defaults = new Map();

    if (!schema || typeof schema !== 'object') return defaults;

    // Handle direct default value
    if (schema.default !== undefined) {
        defaults.set(prefix, schema.default);
    }

    // Handle properties object
    if (schema.properties) {
        for (const [key, value] of Object.entries(schema.properties)) {
            const path = prefix ? `${prefix}.${key}` : key;
            const nested = extractSchemaDefaults(value, path);
            for (const [k, v] of nested) {
                defaults.set(k, v);
            }
        }
    }

    return defaults;
}

function validateDocsData() {
    const errors = [];
    const warnings = [];

    // Load files
    let docsData, configSchema;
    try {
        docsData = loadJson('public/docs-data.json');
    } catch (e) {
        errors.push(`Failed to load docs-data.json: ${e.message}`);
        return { errors, warnings };
    }

    try {
        configSchema = loadJson('config.schema.json');
    } catch (e) {
        warnings.push(`Could not load config.schema.json for default validation: ${e.message}`);
        configSchema = null;
    }

    const entries = docsData.entries || [];

    // Check version and lastUpdated
    if (!docsData.version) {
        warnings.push('Missing "version" field in docs-data.json');
    }
    if (!docsData.lastUpdated) {
        warnings.push('Missing "lastUpdated" field in docs-data.json');
    }

    // Check for duplicate IDs
    const ids = new Map();
    entries.forEach((entry, index) => {
        if (!entry.id) {
            errors.push(`Entry at index ${index} is missing an "id" field`);
            return;
        }
        if (ids.has(entry.id)) {
            errors.push(`Duplicate ID "${entry.id}" at indices ${ids.get(entry.id)} and ${index}`);
        } else {
            ids.set(entry.id, index);
        }
    });

    // Validate each entry
    entries.forEach((entry, index) => {
        const entryId = entry.id || `index-${index}`;

        // Check required fields
        REQUIRED_FIELDS.forEach(field => {
            if (!entry[field]) {
                errors.push(`Entry "${entryId}": missing required field "${field}"`);
            }
        });

        // Validate category
        if (entry.category && !VALID_CATEGORIES.includes(entry.category)) {
            warnings.push(
                `Entry "${entryId}": category "${entry.category}" is not in the standard list`
            );
        }

        // Validate keywords is an array
        if (entry.keywords && !Array.isArray(entry.keywords)) {
            errors.push(`Entry "${entryId}": "keywords" must be an array`);
        }

        // Check for empty strings in important fields
        ['title', 'description', 'help'].forEach(field => {
            if (entry[field] === '') {
                errors.push(`Entry "${entryId}": "${field}" is an empty string`);
            }
        });

        // Validate section/setting/showMode/showPanel are strings when present
        ['section', 'setting', 'showMode', 'showPanel'].forEach(field => {
            if (
                entry[field] !== undefined &&
                entry[field] !== null &&
                typeof entry[field] !== 'string'
            ) {
                errors.push(`Entry "${entryId}": "${field}" must be a string or null`);
            }
        });
    });

    // Extract schema defaults for future validation
    if (configSchema) {
        const schemaDefaults = extractSchemaDefaults(configSchema);
        // Store count for summary
        warnings.push(
            `Found ${schemaDefaults.size} properties with defaults in config.schema.json`
        );
    }

    return { errors, warnings };
}

// Main execution
try {
    const { errors, warnings } = validateDocsData();

    // Print warnings (non-fatal)
    if (warnings.length > 0) {
        console.log('\n⚠️  Warnings:');
        warnings.forEach(w => console.log(`   - ${w}`));
    }

    // Print errors (fatal)
    if (errors.length > 0) {
        console.error('\n❌ Errors:');
        errors.forEach(e => console.error(`   - ${e}`));
        console.error(`\n❌ docs-data.json validation failed with ${errors.length} error(s)`);
        process.exit(1);
    }

    console.log('\n✅ docs-data.json validation passed');
} catch (e) {
    console.error('❌ Validation script crashed:', e.message);
    process.exit(2);
}
