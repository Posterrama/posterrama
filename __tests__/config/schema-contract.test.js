const fs = require('fs');
const path = require('path');

describe('config.schema.json covers example config keys', () => {
    test('All top-level keys in config.example.json exist in schema properties', () => {
        const root = path.resolve(__dirname, '..', '..');
        const schema = JSON.parse(fs.readFileSync(path.join(root, 'config.schema.json'), 'utf8'));
        const example = JSON.parse(fs.readFileSync(path.join(root, 'config.example.json'), 'utf8'));

        const schemaProps = new Set(Object.keys(schema.properties || {}));
        const exampleKeys = Object.keys(example);

        const missing = exampleKeys.filter(k => !schemaProps.has(k));

        // Allowlist keys that are intentionally not part of schema (none currently)
        const allowlist = new Set([]);
        const missingNotAllowed = missing.filter(k => !allowlist.has(k));

        if (missingNotAllowed.length) {
            throw new Error(
                'Schema missing keys found in config.example.json: ' + missingNotAllowed.join(', ')
            );
        }
    });
});
