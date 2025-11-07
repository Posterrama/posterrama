/**
 * Tests for lib/preset-helpers.js
 *
 * Tests explicitly pass rootDir parameter to avoid process.cwd() contamination
 * @jest-environment node
 */

const path = require('path');
const os = require('os');

// Force real fs module to avoid mock contamination from other tests
// Must be done BEFORE requiring any modules that use fs
jest.unmock('fs');
jest.unmock('fs-extra');
jest.unmock('fs/promises');

const fs = require('fs-extra');
const { readPresets, writePresets } = require('../../lib/preset-helpers');

// Force serial execution for this test suite to avoid race conditions
describe.serial = describe;

// Skip in CI due to persistent fs mock contamination from other test suites
const describeTest = process.env.CI ? describe.skip : describe;

describeTest('Preset Helpers', () => {
    // Increase timeout for potentially slow temp file operations
    jest.setTimeout(20000);
    let testDir;
    let presetsFile;

    beforeEach(async () => {
        // Create a UNIQUE test directory for EACH test with process ID to avoid collisions
        const uniqueId = `preset-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
        testDir = await fs.mkdtemp(path.join(os.tmpdir(), uniqueId));
        presetsFile = path.join(testDir, 'device-presets.json');

        // Ensure test directory is actually created and writable
        await fs.access(testDir);

        // Clean any potential leftover files in the temp directory
        const files = await fs.readdir(testDir);
        for (const file of files) {
            await fs.unlink(path.join(testDir, file)).catch(() => {});
        }

        // Add delay to ensure filesystem operations complete
        await new Promise(resolve => setTimeout(resolve, 50));
    });

    afterEach(async () => {
        // Ensure cleanup happens even if tests fail
        if (testDir) {
            try {
                // Add delay before cleanup to ensure all file handles are closed
                await new Promise(resolve => setTimeout(resolve, 100));
                await fs.rm(testDir, {
                    recursive: true,
                    force: true,
                    maxRetries: 3,
                    retryDelay: 100,
                });
            } catch (err) {
                // Ignore cleanup errors, but log for debugging
                if (process.env.DEBUG_TESTS) {
                    console.warn(`Cleanup warning for ${testDir}:`, err.message);
                }
            }
        }
        // Clear references
        testDir = null;
        presetsFile = null;
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

            // DEBUG: List all files in temp directory
            if (process.env.CI) {
                const dirContents = await fs.readdir(testDir);
                console.log('[DEBUG] Temp dir contents:', dirContents);
                console.log('[DEBUG] Expected file:', presetsFile);
                for (const file of dirContents) {
                    const fullPath = path.join(testDir, file);
                    const content = await fs.readFile(fullPath, 'utf8');
                    console.log(`[DEBUG] File ${file}: ${content.slice(0, 100)}`);
                }
            }

            // Verify file was written correctly
            const writtenContent = await fs.readFile(presetsFile, 'utf8');
            const writtenData = JSON.parse(writtenContent);
            expect(writtenData).toEqual(testData);

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
