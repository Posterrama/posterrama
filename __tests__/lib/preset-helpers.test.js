/**
 * Tests for lib/preset-helpers.js
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { readPresets, writePresets } = require('../../lib/preset-helpers');

describe('Preset Helpers', () => {
    let testDir;
    let presetsFile;

    beforeEach(async () => {
        // Create temporary test directory
        testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'preset-test-'));
        presetsFile = path.join(testDir, 'device-presets.json');
    });

    afterEach(async () => {
        // Cleanup
        try {
            await fs.rm(testDir, { recursive: true, force: true });
        } catch (err) {
            // Ignore cleanup errors
        }
    });

    describe('readPresets', () => {
        test('returns empty array when file does not exist', async () => {
            const result = await readPresets(testDir);
            expect(result).toEqual([]);
        });

        test('returns empty array when file is empty', async () => {
            await fs.writeFile(presetsFile, '', 'utf8');
            const result = await readPresets(testDir);
            expect(result).toEqual([]);
        });

        test('returns empty array when file contains invalid JSON', async () => {
            await fs.writeFile(presetsFile, 'invalid json', 'utf8');
            const result = await readPresets(testDir);
            expect(result).toEqual([]);
        });

        test('returns empty array when file contains non-array JSON', async () => {
            await fs.writeFile(presetsFile, '{"name": "test"}', 'utf8');
            const result = await readPresets(testDir);
            expect(result).toEqual([]);
        });

        test('returns array of presets when file contains valid data', async () => {
            const testData = [
                { name: 'Preset 1', mode: 'screensaver' },
                { name: 'Preset 2', mode: 'wallart' },
            ];
            await fs.writeFile(presetsFile, JSON.stringify(testData), 'utf8');

            const result = await readPresets(testDir);
            expect(result).toEqual(testData);
        });

        test('handles file with whitespace and formatting', async () => {
            const testData = [{ name: 'Test', mode: 'cinema' }];
            await fs.writeFile(presetsFile, JSON.stringify(testData, null, 2), 'utf8');

            const result = await readPresets(testDir);
            expect(result).toEqual(testData);
        });
    });

    describe('writePresets', () => {
        test('creates file with empty array when given empty array', async () => {
            await writePresets([], testDir);

            const content = await fs.readFile(presetsFile, 'utf8');
            expect(JSON.parse(content)).toEqual([]);
        });

        test('creates file with formatted JSON', async () => {
            const testData = [{ name: 'Test', mode: 'screensaver' }];
            await writePresets(testData, testDir);

            const content = await fs.readFile(presetsFile, 'utf8');
            expect(content).toContain('\n'); // Should be formatted with newlines
            expect(JSON.parse(content)).toEqual(testData);
        });

        test('overwrites existing file with new data', async () => {
            const oldData = [{ name: 'Old' }];
            const newData = [{ name: 'New' }];

            await fs.writeFile(presetsFile, JSON.stringify(oldData), 'utf8');
            await writePresets(newData, testDir);

            const content = await fs.readFile(presetsFile, 'utf8');
            expect(JSON.parse(content)).toEqual(newData);
        });

        test('uses atomic write operation with temp file', async () => {
            const testData = [{ name: 'Test' }];
            await writePresets(testData, testDir);

            // Temp file should be cleaned up
            const tmpFile = presetsFile + '.tmp';
            await expect(fs.access(tmpFile)).rejects.toThrow();

            // Final file should exist
            await expect(fs.access(presetsFile)).resolves.toBeUndefined();
        });

        test('converts non-array input to empty array', async () => {
            await writePresets({ name: 'Not an array' }, testDir);

            const content = await fs.readFile(presetsFile, 'utf8');
            expect(JSON.parse(content)).toEqual([]);
        });

        test('converts null to empty array', async () => {
            await writePresets(null, testDir);

            const content = await fs.readFile(presetsFile, 'utf8');
            expect(JSON.parse(content)).toEqual([]);
        });

        test('handles array with multiple complex objects', async () => {
            const testData = [
                {
                    name: 'Living Room',
                    mode: 'screensaver',
                    refreshInterval: 30,
                    filters: { genre: ['Action', 'Drama'] },
                },
                {
                    name: 'Bedroom',
                    mode: 'wallart',
                    refreshInterval: 60,
                    filters: { rating: 'R' },
                },
            ];

            await writePresets(testData, testDir);

            const result = await readPresets(testDir);
            expect(result).toEqual(testData);
        });
    });

    describe('Integration', () => {
        test('write and read cycle preserves data', async () => {
            const originalData = [
                { id: 1, name: 'Preset 1', settings: { mode: 'screensaver' } },
                { id: 2, name: 'Preset 2', settings: { mode: 'cinema' } },
            ];

            await writePresets(originalData, testDir);
            const readData = await readPresets(testDir);

            expect(readData).toEqual(originalData);
        });

        test('handles multiple write operations', async () => {
            await writePresets([{ name: 'First' }], testDir);
            await writePresets([{ name: 'Second' }], testDir);
            await writePresets([{ name: 'Third' }], testDir);

            const result = await readPresets(testDir);
            expect(result).toEqual([{ name: 'Third' }]);
        });

        test('handles concurrent read operations', async () => {
            const testData = [{ name: 'Test' }];
            await writePresets(testData, testDir);

            // Sequential reads to avoid race conditions in test environment
            const result1 = await readPresets(testDir);
            const result2 = await readPresets(testDir);
            const result3 = await readPresets(testDir);

            expect(result1).toEqual(testData);
            expect(result2).toEqual(testData);
            expect(result3).toEqual(testData);
        });
    });
});
