/**
 * Help Documentation Coverage Test
 *
 * This test ensures that:
 * 1. All documented settings in docs-data.json exist in admin.html
 * 2. All navigation elements (section, showMode, showPanel) are valid
 * 3. No duplicate entry IDs
 * 4. All required fields are present
 *
 * Run with: npm test -- __tests__/docs/help-documentation-coverage.test.js
 */

const fs = require('fs');
const path = require('path');

describe('Help Documentation Coverage', () => {
    let docsData;
    let adminHtml;
    let documentedSettingIds;

    beforeAll(() => {
        const docsPath = path.join(__dirname, '../../public/docs-data.json');
        const adminPath = path.join(__dirname, '../../public/admin.html');

        docsData = JSON.parse(fs.readFileSync(docsPath, 'utf8'));
        adminHtml = fs.readFileSync(adminPath, 'utf8');

        // Collect all documented setting IDs
        documentedSettingIds = new Set(docsData.entries.filter(e => e.setting).map(e => e.setting));
    });

    /**
     * Extract all form element IDs from admin.html
     * This finds checkboxes, text inputs, number inputs, selects, etc.
     */
    function extractFormElementIds() {
        const formElementIds = new Set();

        // Match input, select, and textarea elements with IDs
        // Pattern 1: <input ... id="xxx" ...>
        // Pattern 2: <select ... id="xxx" ...>
        // Pattern 3: id="xxx" ... type="checkbox|text|number|range|password"
        const patterns = [
            /<input[^>]+id="([^"]+)"[^>]*type="(?:checkbox|text|number|range|password)"/gi,
            /id="([^"]+)"[^>]*type="(?:checkbox|text|number|range|password)"/gi,
            /<select[^>]+id="([^"]+)"/gi,
        ];

        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(adminHtml)) !== null) {
                formElementIds.add(match[1]);
            }
        }

        return formElementIds;
    }

    test('docs-data.json exists and is valid JSON', () => {
        expect(docsData).toBeDefined();
        expect(docsData.version).toBeDefined();
        expect(Array.isArray(docsData.entries)).toBe(true);
    });

    test('docs-data.json has minimum required entries', () => {
        // We expect at least 150 entries for a complete help system
        expect(docsData.entries.length).toBeGreaterThanOrEqual(150);
    });

    test('all documented setting IDs exist in admin.html', () => {
        const missingInHtml = [];

        for (const entry of docsData.entries) {
            if (entry.setting && entry.setting !== '') {
                // Check if this setting ID exists in admin.html
                const idPattern = `id="${entry.setting}"`;
                if (!adminHtml.includes(idPattern)) {
                    missingInHtml.push({
                        id: entry.id,
                        setting: entry.setting,
                        title: entry.title,
                    });
                }
            }
        }

        if (missingInHtml.length > 0) {
            console.log('\n❌ Documented settings NOT found in admin.html:');
            missingInHtml.forEach(m => {
                console.log(`   - ${m.setting} (from entry: ${m.id})`);
            });
            console.log('\n   These settings may have been renamed or removed.');
            console.log('   Update docs-data.json to match admin.html.\n');
        }

        expect(missingInHtml).toHaveLength(0);
    });

    test('all navigation elements (showPanel, showMode, section) are valid', () => {
        const errors = [];

        // Valid navigation values based on admin.html structure
        const validSections = ['dashboard', 'display', 'media-sources', 'devices', 'operations'];
        const validShowModes = ['cinema', 'screensaver', 'wallart'];
        const validShowPanels = [
            'panel-plex',
            'panel-jellyfin',
            'panel-tmdb',
            'panel-romm',
            'panel-local',
        ];

        for (const entry of docsData.entries) {
            // Check section
            if (entry.section && !validSections.includes(entry.section)) {
                // Verify it exists in HTML
                if (!adminHtml.includes(`data-nav="${entry.section}"`)) {
                    errors.push(`Invalid section "${entry.section}" in entry ${entry.id}`);
                }
            }

            // Check showMode
            if (entry.showMode && !validShowModes.includes(entry.showMode)) {
                errors.push(`Invalid showMode "${entry.showMode}" in entry ${entry.id}`);
            }

            // Check showPanel
            if (entry.showPanel && !validShowPanels.includes(entry.showPanel)) {
                // Verify it exists in HTML as data-panel or id
                const panelExists =
                    adminHtml.includes(`data-panel="${entry.showPanel}"`) ||
                    adminHtml.includes(`id="${entry.showPanel}"`);
                if (!panelExists) {
                    errors.push(`Invalid showPanel "${entry.showPanel}" in entry ${entry.id}`);
                }
            }
        }

        if (errors.length > 0) {
            console.log('\n❌ Invalid navigation elements:');
            errors.forEach(e => console.log(`   - ${e}`));
        }

        expect(errors).toHaveLength(0);
    });

    test('each entry has required fields', () => {
        const requiredFields = ['id', 'title', 'category', 'keywords', 'description', 'help'];
        const errors = [];

        docsData.entries.forEach((entry, index) => {
            requiredFields.forEach(field => {
                if (!entry[field]) {
                    errors.push(`Entry ${index} (${entry.id || 'unknown'}): missing ${field}`);
                }
            });

            // Keywords should be an array
            if (entry.keywords && !Array.isArray(entry.keywords)) {
                errors.push(`Entry ${entry.id}: keywords should be an array`);
            }

            // Keywords should not be empty
            if (Array.isArray(entry.keywords) && entry.keywords.length === 0) {
                errors.push(`Entry ${entry.id}: keywords array is empty`);
            }
        });

        if (errors.length > 0) {
            console.log('\n❌ Entries with missing required fields:');
            errors.slice(0, 10).forEach(e => console.log(`   - ${e}`));
            if (errors.length > 10) {
                console.log(`   ... and ${errors.length - 10} more`);
            }
        }

        expect(errors).toHaveLength(0);
    });

    test('no duplicate entry IDs', () => {
        const ids = docsData.entries.map(e => e.id);
        const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);

        if (duplicates.length > 0) {
            console.log('\n❌ Duplicate entry IDs:');
            [...new Set(duplicates)].forEach(id => console.log(`   - ${id}`));
        }

        expect(duplicates).toHaveLength(0);
    });

    test('no duplicate setting IDs', () => {
        const settings = docsData.entries.filter(e => e.setting).map(e => e.setting);
        const duplicates = settings.filter((id, index) => settings.indexOf(id) !== index);

        if (duplicates.length > 0) {
            console.log('\n❌ Duplicate setting IDs (same HTML element documented twice):');
            [...new Set(duplicates)].forEach(id => console.log(`   - ${id}`));
        }

        expect(duplicates).toHaveLength(0);
    });

    test('categories are consistent', () => {
        const validCategories = [
            'Getting Started',
            'Display Modes',
            'Cinema',
            'Screensaver',
            'Wallart',
            'Media Sources',
            'Devices',
            'Integrations',
            'System',
            'Troubleshooting',
        ];

        const invalidCategories = [];

        docsData.entries.forEach(entry => {
            if (!validCategories.includes(entry.category)) {
                invalidCategories.push({
                    id: entry.id,
                    category: entry.category,
                });
            }
        });

        if (invalidCategories.length > 0) {
            console.log('\n❌ Entries with invalid categories:');
            invalidCategories.forEach(e => console.log(`   - ${e.id}: "${e.category}"`));
            console.log('\n   Valid categories:', validCategories.join(', '));
        }

        expect(invalidCategories).toHaveLength(0);
    });

    test('documentation coverage summary', () => {
        const formElementIds = extractFormElementIds();
        const documentedFormElements = [...formElementIds].filter(id =>
            documentedSettingIds.has(id)
        );

        // Count entries by category
        const categoryCounts = {};
        docsData.entries.forEach(entry => {
            categoryCounts[entry.category] = (categoryCounts[entry.category] || 0) + 1;
        });

        console.log('\n📊 Documentation Coverage Summary:');
        console.log(`   Total entries: ${docsData.entries.length}`);
        console.log(`   Entries with settings: ${documentedSettingIds.size}`);
        console.log(`   Form elements in admin.html: ${formElementIds.size}`);
        console.log(`   Form elements documented: ${documentedFormElements.length}`);
        console.log('\n   Entries by category:');
        Object.entries(categoryCounts)
            .sort((a, b) => b[1] - a[1])
            .forEach(([category, count]) => {
                console.log(`     - ${category}: ${count}`);
            });

        // This test always passes - it's just for reporting
        expect(true).toBe(true);
    });
});
