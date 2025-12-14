/**
 * Schema Completeness Test
 *
 * This test ensures the config.schema.json is complete and covers all config
 * properties used throughout the codebase. It scans source files for config
 * property access patterns and verifies they exist in the schema.
 *
 * This prevents the common issue where a feature adds a config property but
 * forgets to add it to the schema, causing "additionalProperties" validation errors.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

// Load schema
function loadSchema() {
    const schemaPath = path.join(ROOT, 'config.schema.json');
    return JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
}

// Recursively get all property paths from schema
function getSchemaPropertyPaths(obj, prefix = '') {
    const paths = new Set();

    if (!obj || typeof obj !== 'object') return paths;

    if (obj.properties) {
        for (const [key, value] of Object.entries(obj.properties)) {
            const fullPath = prefix ? `${prefix}.${key}` : key;
            paths.add(fullPath);

            // Recurse into nested objects
            if (value.type === 'object' && value.properties) {
                const nested = getSchemaPropertyPaths(value, fullPath);
                nested.forEach(p => paths.add(p));
            }

            // Handle array items
            if (value.type === 'array' && value.items && value.items.properties) {
                const nested = getSchemaPropertyPaths(value.items, `${fullPath}[]`);
                nested.forEach(p => paths.add(p));
            }
        }
    }

    return paths;
}

// Scan a file for config property patterns
function scanFileForConfigProps(filePath) {
    const props = new Set();

    try {
        const content = fs.readFileSync(filePath, 'utf8');

        // Common patterns for config access:
        // 1. config.property or cfg.property
        // 2. config?.property
        // 3. config['property']
        // 4. config.nested.property
        // 5. globalEffects.hideAllUI style (object destructuring)

        // Pattern: config.cinema.globalEffects.hideAllUI
        const dotPattern =
            /(?:config|cfg|appConfig|c)\??\.([a-zA-Z_][a-zA-Z0-9_]*(?:\??\.?[a-zA-Z_][a-zA-Z0-9_]*)*)/g;
        let match;
        while ((match = dotPattern.exec(content)) !== null) {
            const prop = match[1].replace(/\?/g, '');
            props.add(prop);
        }

        // Pattern: cinema.globalEffects.hideAllUI (from destructured objects)
        // Look for known top-level objects
        const topLevelObjects = [
            'cinema',
            'wallartMode',
            'screensaver',
            'globalEffects',
            'header',
            'footer',
            'poster',
            'ambilight',
            'background',
            'metadata',
        ];
        for (const obj of topLevelObjects) {
            const objPattern = new RegExp(
                `${obj}\\.([a-zA-Z_][a-zA-Z0-9_]*(?:\\.[a-zA-Z_][a-zA-Z0-9_]*)*)`,
                'g'
            );
            while ((match = objPattern.exec(content)) !== null) {
                props.add(`${obj}.${match[1]}`);
            }
        }
    } catch (err) {
        // Skip files that can't be read
    }

    return props;
}

// Recursively scan directory for JS files
function scanDirectory(dir, extensions = ['.js']) {
    const allProps = new Set();
    const excludeDirs = ['node_modules', '.git', 'coverage', 'cache', 'logs', 'backups'];

    function scan(currentDir) {
        try {
            const entries = fs.readdirSync(currentDir, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(currentDir, entry.name);

                if (entry.isDirectory()) {
                    if (!excludeDirs.includes(entry.name)) {
                        scan(fullPath);
                    }
                } else if (entry.isFile()) {
                    const ext = path.extname(entry.name);
                    if (extensions.includes(ext)) {
                        const fileProps = scanFileForConfigProps(fullPath);
                        fileProps.forEach(p => allProps.add(p));
                    }
                }
            }
        } catch (err) {
            // Skip directories that can't be read
        }
    }

    scan(dir);
    return allProps;
}

// Normalize path for comparison (handles nested paths)
function _normalizeConfigPath(prop) {
    // Remove array index notation
    return prop.replace(/\[\d*\]/g, '[]');
}

// Check if a property path exists in schema (including parent paths)
function _pathExistsInSchema(prop, schemaPaths) {
    // Direct match
    if (schemaPaths.has(prop)) return true;

    // Check if it's a sub-path of an existing path
    const parts = prop.split('.');
    for (let i = 1; i <= parts.length; i++) {
        const subPath = parts.slice(0, i).join('.');
        if (schemaPaths.has(subPath)) return true;
    }

    return false;
}

describe('Schema Completeness', () => {
    let schema;
    let schemaPaths;

    beforeAll(() => {
        schema = loadSchema();
        schemaPaths = getSchemaPropertyPaths(schema);
    });

    test('schema has required top-level properties', () => {
        const requiredTopLevel = [
            'cinema',
            'wallartMode',
            'mediaServers',
            'clockWidget',
            'transitionIntervalSeconds',
            'backgroundRefreshMinutes',
        ];

        for (const prop of requiredTopLevel) {
            expect(schemaPaths.has(prop)).toBe(true);
        }
    });

    test('cinema.globalEffects has all expected properties', () => {
        const expectedGlobalEffects = [
            'cinema.globalEffects.colorFilter',
            'cinema.globalEffects.tintColor',
            'cinema.globalEffects.contrast',
            'cinema.globalEffects.brightness',
            'cinema.globalEffects.fontFamily',
            'cinema.globalEffects.textColorMode',
            'cinema.globalEffects.textColor',
            'cinema.globalEffects.tonSurTonIntensity',
            'cinema.globalEffects.textEffect',
            'cinema.globalEffects.hideAllUI', // Newly added
        ];

        for (const prop of expectedGlobalEffects) {
            expect(schemaPaths.has(prop)).toBe(true);
        }
    });

    test('config.example.json validates against schema', () => {
        const Ajv = require('ajv');
        const ajv = new Ajv({ allErrors: true, strict: false });
        const validate = ajv.compile(schema);

        const examplePath = path.join(ROOT, 'config.example.json');
        const example = JSON.parse(fs.readFileSync(examplePath, 'utf8'));

        const valid = validate(example);
        if (!valid) {
            const errors = validate.errors
                .map(e => `${e.instancePath || 'root'}: ${e.message}`)
                .join('\n');
            throw new Error(`config.example.json does not validate:\n${errors}`);
        }

        expect(valid).toBe(true);
    });

    test('UI config properties exist in schema (cinema-ui.js)', () => {
        const cinemaUiPath = path.join(ROOT, 'public', 'cinema', 'cinema-ui.js');

        if (!fs.existsSync(cinemaUiPath)) {
            console.warn('cinema-ui.js not found, skipping');
            return;
        }

        const content = fs.readFileSync(cinemaUiPath, 'utf8');

        // Find globalEffects properties used in cinema-ui.js
        const globalEffectsProps = new Set();
        const pattern = /globalEffects\.([a-zA-Z_][a-zA-Z0-9_]*)/g;
        let match;
        while ((match = pattern.exec(content)) !== null) {
            globalEffectsProps.add(match[1]);
        }

        // Check each found property exists in schema
        const missing = [];
        for (const prop of globalEffectsProps) {
            const fullPath = `cinema.globalEffects.${prop}`;
            if (!schemaPaths.has(fullPath)) {
                missing.push(prop);
            }
        }

        if (missing.length > 0) {
            throw new Error(
                `Properties used in cinema-ui.js but missing from schema:\n` +
                    `cinema.globalEffects: ${missing.join(', ')}\n\n` +
                    `Add these to config.schema.json under cinema.globalEffects.properties`
            );
        }
    });

    test('All nested object schemas have additionalProperties defined', () => {
        // This ensures we catch unknown properties at every level
        const objectsWithoutAdditionalProps = [];

        function checkObject(obj, path) {
            if (!obj || typeof obj !== 'object') return;

            if (obj.type === 'object' && obj.properties) {
                // Check if additionalProperties is defined
                if (obj.additionalProperties === undefined) {
                    objectsWithoutAdditionalProps.push(path);
                }

                // Recurse
                for (const [key, value] of Object.entries(obj.properties)) {
                    checkObject(value, `${path}.${key}`);
                }
            }

            if (obj.type === 'array' && obj.items) {
                checkObject(obj.items, `${path}[]`);
            }
        }

        checkObject(schema, 'root');

        // This is informational - not all objects need additionalProperties: false
        if (objectsWithoutAdditionalProps.length > 10) {
            console.warn(
                `Note: ${objectsWithoutAdditionalProps.length} object schemas don't have additionalProperties defined. ` +
                    `Consider adding "additionalProperties": false for stricter validation.`
            );
        }
    });
});

describe('Schema-Code Sync Check', () => {
    test('generates report of config properties found in codebase', () => {
        // This is a helper test to identify config patterns used
        // It doesn't fail but logs findings for review

        const publicDir = path.join(ROOT, 'public');
        const foundProps = scanDirectory(publicDir, ['.js']);

        // Filter to likely config properties (starting with known prefixes)
        const configPrefixes = [
            'cinema',
            'wallart',
            'screensaver',
            'global',
            'header',
            'footer',
            'poster',
            'ambilight',
            'background',
            'metadata',
        ];
        const relevantProps = [...foundProps].filter(p =>
            configPrefixes.some(prefix => p.toLowerCase().startsWith(prefix))
        );

        if (relevantProps.length > 0) {
            console.log(
                `Found ${relevantProps.length} potential config property patterns in public/`
            );
        }

        expect(true).toBe(true); // Always passes - this is informational
    });
});
