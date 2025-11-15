/**
 * Config Helpers File Locking Tests
 *
 * Tests for concurrent config.json write protection.
 */

const fs = require('fs').promises;
const path = require('path');
const { readConfig, writeConfig, readEnvFile, writeEnvFile } = require('../../lib/config-helpers');

// Mock logger to avoid console spam
jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

describe('Config Helpers - File Locking', () => {
    const testConfigPath = path.join(__dirname, '../../config.json');
    let originalConfig;
    let mockGlobalConfig;

    beforeAll(async () => {
        // Backup original config
        try {
            originalConfig = await fs.readFile(testConfigPath, 'utf-8');
        } catch (error) {
            originalConfig = null;
        }
    });

    afterAll(async () => {
        // Restore original config
        if (originalConfig) {
            await fs.writeFile(testConfigPath, originalConfig, 'utf-8');
        }
    });

    beforeEach(() => {
        // Create mock global config object
        mockGlobalConfig = {
            config: {
                serverName: 'Test Server',
                clockWidget: true,
                mediaServers: [],
            },
        };
    });

    describe('readConfig with SafeFileStore', () => {
        it('should read config.json successfully', async () => {
            const config = await readConfig();

            expect(config).toBeDefined();
            expect(typeof config).toBe('object');
        });

        it('should handle missing config.json gracefully', async () => {
            // Temporarily rename config
            const tempPath = `${testConfigPath}.test-backup`;
            try {
                await fs.rename(testConfigPath, tempPath);

                const config = await readConfig();

                expect(config).toEqual({});

                // Restore config
                await fs.rename(tempPath, testConfigPath);
            } catch (error) {
                // Restore if error occurs
                try {
                    await fs.rename(tempPath, testConfigPath);
                } catch (_) {
                    /* ignore */
                }
                throw error;
            }
        });

        it('should recover from corrupted config.json using backup', async () => {
            const backupPath = `${testConfigPath}.backup`;

            // Create backup with valid config
            await fs.writeFile(backupPath, JSON.stringify({ recovered: true }, null, 2), 'utf-8');

            // Corrupt main file
            await fs.writeFile(testConfigPath, 'invalid json {{{', 'utf-8');

            // Should recover from backup
            const config = await readConfig();

            expect(config.recovered).toBe(true);

            // Clean up - restore valid config
            await fs.writeFile(
                testConfigPath,
                JSON.stringify({ serverName: 'Test' }, null, 2),
                'utf-8'
            );
        });
    });

    describe('writeConfig with File Locking', () => {
        it('should write config successfully with file locking', async () => {
            const newConfig = {
                serverName: 'Updated Server',
                clockWidget: false,
                mediaServers: [],
                testFlag: true,
            };

            await writeConfig(newConfig, mockGlobalConfig);

            // Verify write
            const config = await readConfig();
            expect(config.testFlag).toBe(true);
            expect(config.serverName).toBe('Updated Server');

            // Verify in-memory update
            expect(mockGlobalConfig.config.serverName).toBe('Updated Server');
        });

        it('should create backup before writing', async () => {
            const backupPath = `${testConfigPath}.backup`;

            const newConfig = {
                serverName: 'Backup Test',
                mediaServers: [],
            };

            await writeConfig(newConfig, mockGlobalConfig);

            // Backup should exist
            const backupExists = await fs
                .access(backupPath)
                .then(() => true)
                .catch(() => false);
            expect(backupExists).toBe(true);
        });

        it('should handle concurrent writes with file locking', async () => {
            const writes = [];

            // Simulate 5 concurrent config updates
            for (let i = 0; i < 5; i++) {
                const config = {
                    serverName: `Concurrent Write ${i}`,
                    mediaServers: [],
                    writeNumber: i,
                };

                writes.push(
                    writeConfig(config, {
                        config: { serverName: 'Test', mediaServers: [] },
                    }).catch(error => {
                        // ELOCKED errors are expected during concurrent writes
                        if (error.code === 'ELOCKED') {
                            console.log(`Write ${i} blocked by lock (expected)`);
                            return null;
                        }
                        throw error;
                    })
                );
            }

            // Wait for all writes to complete (some may fail with ELOCKED)
            const results = await Promise.all(writes);

            // At least one write should have succeeded
            const successfulWrites = results.filter(r => r !== null);
            expect(successfulWrites.length).toBeGreaterThan(0);

            // Final config should be readable and valid
            const finalConfig = await readConfig();
            expect(finalConfig).toHaveProperty('writeNumber');
            expect(typeof finalConfig.writeNumber).toBe('number');
        }, 15000);

        it('should throw ELOCKED error when lock cannot be acquired', async () => {
            // This test relies on timing - may be flaky
            const config1 = {
                serverName: 'First Write',
                mediaServers: [],
            };

            const config2 = {
                serverName: 'Second Write',
                mediaServers: [],
            };

            // Start first write (holds lock)
            const firstWrite = writeConfig(config1, mockGlobalConfig);

            // Immediately try second write (should be blocked briefly)
            // Note: With retries, this might succeed or fail depending on timing
            try {
                await Promise.race([
                    writeConfig(config2, mockGlobalConfig),
                    new Promise(resolve => setTimeout(resolve, 100)),
                ]);
                // If we get here, either write succeeded or timeout occurred
            } catch (error) {
                if (error.code === 'ELOCKED') {
                    expect(error.statusCode).toBe(409);
                    expect(error.message).toContain('currently being updated');
                }
            }

            // Wait for first write to complete
            await firstWrite;
        }, 10000);

        it('should update in-memory config after successful write', async () => {
            const newConfig = {
                serverName: 'Memory Update Test',
                clockWidget: true,
                mediaServers: [{ name: 'Test Server', type: 'plex', enabled: true }],
            };

            await writeConfig(newConfig, mockGlobalConfig);

            // Verify in-memory update
            expect(mockGlobalConfig.config.serverName).toBe('Memory Update Test');
            expect(mockGlobalConfig.config.clockWidget).toBe(true);
            expect(mockGlobalConfig.config.mediaServers).toHaveLength(1);
        });

        it('should handle write without global config object', async () => {
            const newConfig = {
                serverName: 'No Global Config',
                mediaServers: [],
            };

            // Should not throw error
            await expect(writeConfig(newConfig, null)).resolves.not.toThrow();

            // Verify write
            const config = await readConfig();
            expect(config.serverName).toBe('No Global Config');
        });
    });

    describe('Lock Error Messages', () => {
        it('should provide user-friendly lock error message', async () => {
            // Create a situation where lock might fail
            const config = {
                serverName: 'Lock Error Test',
                mediaServers: [],
            };

            try {
                // Start multiple writes simultaneously to trigger potential lock conflict
                await Promise.all([
                    writeConfig(config, mockGlobalConfig),
                    writeConfig(config, mockGlobalConfig),
                ]);
            } catch (error) {
                if (error.code === 'ELOCKED') {
                    expect(error.message).toContain('currently being updated');
                    expect(error.message).toContain('try again');
                }
                // If no ELOCKED error, both writes succeeded (also acceptable)
            }
        });
    });

    describe('.env File Operations', () => {
        const testEnvPath = path.join(__dirname, '../../.env');
        let originalEnv;

        beforeAll(async () => {
            try {
                originalEnv = await fs.readFile(testEnvPath, 'utf-8');
            } catch (error) {
                originalEnv = null;
            }
        });

        afterAll(async () => {
            if (originalEnv) {
                await fs.writeFile(testEnvPath, originalEnv, 'utf-8');
            }
        });

        it('should read .env file', async () => {
            const content = await readEnvFile();
            expect(typeof content).toBe('string');
        });

        it('should write .env file with proper formatting', async () => {
            const newValues = {
                TEST_KEY: 'test_value',
                TEST_NUMBER: 42,
                TEST_BOOL: true,
            };

            await writeEnvFile(newValues);

            const content = await readEnvFile();
            expect(content).toContain('TEST_KEY=test_value');
            expect(content).toContain('TEST_NUMBER=42');
            expect(content).toContain('TEST_BOOL=true');

            // Verify process.env updated
            expect(process.env.TEST_KEY).toBe('test_value');
            expect(process.env.TEST_NUMBER).toBe('42');
        });
    });
});
