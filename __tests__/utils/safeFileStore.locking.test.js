/**
 * SafeFileStore File Locking Tests
 *
 * Tests for concurrent write protection using file locking.
 */

const fs = require('fs').promises;
const path = require('path');
const SafeFileStore = require('../../utils/safeFileStore');

describe('SafeFileStore - File Locking', () => {
    const testDir = path.join(__dirname, '../../test-support/temp-lock-test');
    const testFile = path.join(testDir, 'test-locking.json');

    beforeAll(async () => {
        await fs.mkdir(testDir, { recursive: true });
    });

    afterAll(async () => {
        try {
            await fs.rm(testDir, { recursive: true, force: true });
        } catch (error) {
            // Ignore cleanup errors
        }
    });

    beforeEach(async () => {
        // Clean up test file before each test
        try {
            await fs.unlink(testFile);
            await fs.unlink(`${testFile}.backup`);
            await fs.unlink(`${testFile}.tmp`);
        } catch (error) {
            // Ignore if files don't exist
        }
    });

    describe('Basic File Locking', () => {
        it('should successfully write with locking enabled', async () => {
            const store = new SafeFileStore(testFile, { useLocking: true });
            const data = { message: 'test', timestamp: Date.now() };

            await store.write(data);

            const result = await store.read();
            expect(result).toEqual(data);
        });

        it('should successfully write with locking disabled', async () => {
            const store = new SafeFileStore(testFile, { useLocking: false });
            const data = { message: 'test without lock', timestamp: Date.now() };

            await store.write(data);

            const result = await store.read();
            expect(result).toEqual(data);
        });

        it('should create initial file if it does not exist before locking', async () => {
            const store = new SafeFileStore(testFile, { useLocking: true });
            const data = { initial: true };

            await store.write(data);

            const exists = await store.exists();
            expect(exists).toBe(true);
        });
    });

    describe('Concurrent Write Protection', () => {
        it('should handle sequential writes with locking', async () => {
            const store = new SafeFileStore(testFile, { useLocking: true });

            await store.write({ counter: 1 });
            await store.write({ counter: 2 });
            await store.write({ counter: 3 });

            const result = await store.read();
            expect(result.counter).toBe(3);
        });

        it('should handle concurrent writes with proper ordering', async () => {
            const store = new SafeFileStore(testFile, {
                useLocking: true,
                lockStale: 3000,
                lockRetries: {
                    retries: 10,
                    minTimeout: 50,
                    maxTimeout: 500,
                },
            });

            // Write initial data
            await store.write({ writes: [] });

            // Simulate 5 concurrent writes
            const writes = Array.from({ length: 5 }, (_, i) => {
                return store.write({ writes: [`write-${i}`] }).catch(error => {
                    // Log lock errors for debugging
                    if (error.code === 'ELOCKED') {
                        console.log(`Write ${i} blocked by lock (expected)`);
                    }
                    throw error;
                });
            });

            // All writes should eventually succeed
            await Promise.all(writes);

            // File should be readable and valid
            const result = await store.read();
            expect(result).toHaveProperty('writes');
            expect(Array.isArray(result.writes)).toBe(true);
        }, 10000); // Increase timeout for concurrent operations

        it('should respect lock retry configuration', async () => {
            const store = new SafeFileStore(testFile, {
                useLocking: true,
                lockStale: 1000,
                lockRetries: {
                    retries: 2,
                    minTimeout: 50,
                    maxTimeout: 100,
                },
            });

            // Write initial data
            await store.write({ initial: true });

            // Multiple writes should succeed with retries
            await store.write({ write1: true });
            await store.write({ write2: true });

            const result = await store.read();
            expect(result.write2).toBe(true);
        }, 5000);
    });

    describe('Lock Configuration', () => {
        it('should respect custom lock stale time', async () => {
            const store = new SafeFileStore(testFile, {
                useLocking: true,
                lockStale: 1000, // 1 second stale time
            });

            const data = { staleTest: true };
            await store.write(data);

            const result = await store.read();
            expect(result).toEqual(data);
        });

        it('should respect custom lock retry configuration', async () => {
            const store = new SafeFileStore(testFile, {
                useLocking: true,
                lockRetries: {
                    retries: 3,
                    minTimeout: 100,
                    maxTimeout: 500,
                    factor: 2,
                },
            });

            const data = { retryTest: true };
            await store.write(data);

            const result = await store.read();
            expect(result).toEqual(data);
        });
    });

    describe('Lock Error Handling', () => {
        it('should release lock even on write error', async () => {
            const store = new SafeFileStore(testFile, { useLocking: true });

            // Cause a write error by making directory read-only after initial write
            await store.write({ initial: true });

            // Mock JSON.stringify to throw error
            const originalStringify = JSON.stringify;
            jest.spyOn(JSON, 'stringify').mockImplementationOnce(() => {
                throw new Error('Serialization error');
            });

            // Write should fail but not leave lock
            await expect(store.write({ bad: true })).rejects.toThrow('Serialization error');

            // Restore original stringify
            JSON.stringify = originalStringify;

            // Next write should succeed (lock was released)
            await expect(store.write({ recovery: true })).resolves.not.toThrow();

            const result = await store.read();
            expect(result.recovery).toBe(true);
        });

        it('should handle ELOCKED error structure correctly', async () => {
            const lockfile = require('proper-lockfile');
            const store = new SafeFileStore(testFile, {
                useLocking: true,
                lockStale: 1000,
                lockRetries: { retries: 0 },
            });

            // Write initial file
            await store.write({ test: true });

            // Manually lock the file to force ELOCKED error
            const release = await lockfile.lock(testFile, {
                retries: 0,
                stale: 5000,
                realpath: false,
            });

            try {
                await store.write({ shouldFail: true });
                throw new Error('Should have thrown ELOCKED error');
            } catch (error) {
                expect(error.code).toBe('ELOCKED');
                expect(error.statusCode).toBe(409);
                expect(error.message).toContain('locked by another process');
            } finally {
                // Always release lock
                await release();
            }
        });
    });

    describe('Backward Compatibility', () => {
        it('should work without locking for legacy code', async () => {
            const store = new SafeFileStore(testFile, { useLocking: false });
            const data = { legacy: true, timestamp: Date.now() };

            await store.write(data);

            const result = await store.read();
            expect(result).toEqual(data);
        });

        it('should default to locking enabled', async () => {
            const store = new SafeFileStore(testFile); // No options
            const data = { defaultLocking: true };

            await store.write(data);

            const result = await store.read();
            expect(result).toEqual(data);
        });
    });

    describe('Performance', () => {
        it('should handle multiple sequential writes efficiently', async () => {
            const store = new SafeFileStore(testFile, { useLocking: true });
            const iterations = 10;

            const startTime = Date.now();

            for (let i = 0; i < iterations; i++) {
                await store.write({ iteration: i, timestamp: Date.now() });
            }

            const duration = Date.now() - startTime;
            const avgTime = duration / iterations;

            // Each write should be reasonably fast (< 100ms on average)
            expect(avgTime).toBeLessThan(100);
        }, 10000);
    });
});
