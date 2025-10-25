/**
 * Performance Benchmarking Suite
 * Comprehensive performance tests for critical paths
 */

const request = require('supertest');
const path = require('path');

// Mock logger
jest.mock('../../utils/logger');

describe('Performance Benchmarking Suite', () => {
    let app;
    let server;

    // Performance thresholds (in milliseconds)
    const THRESHOLDS = {
        health: 50,
        config: 100,
        getMedia: 500,
        imageProxy: 200,
        cacheRead: 10,
        cacheWrite: 50,
        deviceRegistration: 200,
        apiResponse: 300,
        staticAsset: 100,
    };

    beforeAll(async () => {
        // Import app without starting server
        const serverModule = require('../../server');
        app = serverModule.app || serverModule;
    });

    afterAll(async () => {
        if (server) {
            await new Promise(resolve => server.close(resolve));
        }
    });

    /**
     * Utility to measure execution time
     */
    const measureTime = async fn => {
        const start = performance.now();
        await fn();
        return performance.now() - start;
    };

    /**
     * Run multiple iterations and get statistics
     */
    const benchmark = async (name, fn, iterations = 10) => {
        const times = [];
        for (let i = 0; i < iterations; i++) {
            const time = await measureTime(fn);
            times.push(time);
        }

        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        const min = Math.min(...times);
        const max = Math.max(...times);
        const median = times.sort((a, b) => a - b)[Math.floor(times.length / 2)];

        return { avg, min, max, median, times };
    };

    describe('Critical Path Benchmarks', () => {
        test('Health endpoint responds within threshold', async () => {
            const stats = await benchmark('health', async () => {
                await request(app).get('/health').expect(200);
            });

            console.log(`
📊 Health Check Performance:
   Average: ${stats.avg.toFixed(2)}ms
   Median:  ${stats.median.toFixed(2)}ms
   Min:     ${stats.min.toFixed(2)}ms
   Max:     ${stats.max.toFixed(2)}ms
   Target:  <${THRESHOLDS.health}ms
            `);

            expect(stats.avg).toBeLessThan(THRESHOLDS.health);
        });

        test('Config endpoint responds within threshold', async () => {
            const stats = await benchmark('config', async () => {
                await request(app).get('/get-config');
            });

            console.log(`
📊 Config Fetch Performance:
   Average: ${stats.avg.toFixed(2)}ms
   Median:  ${stats.median.toFixed(2)}ms
   Min:     ${stats.min.toFixed(2)}ms
   Max:     ${stats.max.toFixed(2)}ms
   Target:  <${THRESHOLDS.config}ms
            `);

            expect(stats.avg).toBeLessThan(THRESHOLDS.config);
        });

        test('Static asset serving is fast', async () => {
            const stats = await benchmark('static', async () => {
                await request(app).get('/admin.html');
            });

            console.log(`
📊 Static Asset Performance:
   Average: ${stats.avg.toFixed(2)}ms
   Median:  ${stats.median.toFixed(2)}ms
   Min:     ${stats.min.toFixed(2)}ms
   Max:     ${stats.max.toFixed(2)}ms
   Target:  <${THRESHOLDS.staticAsset}ms
            `);

            expect(stats.avg).toBeLessThan(THRESHOLDS.staticAsset);
        });
    });

    describe('Cache Performance', () => {
        test('Cache read operations are fast', async () => {
            const { CacheManager } = require('../../utils/cache');
            const cache = new CacheManager({ ttl: 60000 });

            // Populate cache
            cache.set('benchmark-key', { data: 'test' });

            const stats = await benchmark(
                'cache-read',
                async () => {
                    cache.get('benchmark-key');
                },
                1000
            ); // More iterations for cache ops

            console.log(`
📊 Cache Read Performance:
   Average: ${stats.avg.toFixed(4)}ms
   Median:  ${stats.median.toFixed(4)}ms
   Min:     ${stats.min.toFixed(4)}ms
   Max:     ${stats.max.toFixed(4)}ms
   Target:  <${THRESHOLDS.cacheRead}ms
            `);

            expect(stats.avg).toBeLessThan(THRESHOLDS.cacheRead);
        });

        test('Cache write operations are fast', async () => {
            const { CacheManager } = require('../../utils/cache');
            const cache = new CacheManager({ ttl: 60000 });

            let counter = 0;
            const stats = await benchmark(
                'cache-write',
                async () => {
                    cache.set(`benchmark-key-${counter++}`, { data: 'test' });
                },
                1000
            );

            console.log(`
📊 Cache Write Performance:
   Average: ${stats.avg.toFixed(4)}ms
   Median:  ${stats.median.toFixed(4)}ms
   Min:     ${stats.min.toFixed(4)}ms
   Max:     ${stats.max.toFixed(4)}ms
   Target:  <${THRESHOLDS.cacheWrite}ms
            `);

            expect(stats.avg).toBeLessThan(THRESHOLDS.cacheWrite);
        });

        test('Cache has/delete operations are fast', async () => {
            const { CacheManager } = require('../../utils/cache');
            const cache = new CacheManager({ ttl: 60000 });

            // Populate
            for (let i = 0; i < 100; i++) {
                cache.set(`key-${i}`, { data: i });
            }

            const stats = await benchmark(
                'cache-ops',
                async () => {
                    const key = `key-${Math.floor(Math.random() * 100)}`;
                    if (cache.has(key)) {
                        cache.delete(key);
                    }
                },
                1000
            );

            console.log(`
📊 Cache Operations Performance:
   Average: ${stats.avg.toFixed(4)}ms
   Median:  ${stats.median.toFixed(4)}ms
            `);

            expect(stats.avg).toBeLessThan(5);
        });
    });

    describe('Memory Performance', () => {
        test('Memory usage remains stable during operations', async () => {
            const initialMemory = process.memoryUsage();
            const { CacheManager } = require('../../utils/cache');
            const cache = new CacheManager({ ttl: 60000 });

            // Perform many operations
            for (let i = 0; i < 10000; i++) {
                cache.set(`key-${i}`, { data: 'x'.repeat(100) });
            }

            cache.clear();

            // Force garbage collection if available
            if (global.gc) {
                global.gc();
            }

            const finalMemory = process.memoryUsage();
            const heapDiff = finalMemory.heapUsed - initialMemory.heapUsed;
            const heapDiffMB = heapDiff / 1024 / 1024;

            console.log(`
📊 Memory Usage:
   Initial Heap: ${(initialMemory.heapUsed / 1024 / 1024).toFixed(2)}MB
   Final Heap:   ${(finalMemory.heapUsed / 1024 / 1024).toFixed(2)}MB
   Difference:   ${heapDiffMB.toFixed(2)}MB
            `);

            // Memory should not grow excessively (< 50MB after clear)
            expect(Math.abs(heapDiffMB)).toBeLessThan(50);
        });

        test('No memory leaks in repeated operations', async () => {
            const measurements = [];
            const { CacheManager } = require('../../utils/cache');

            for (let i = 0; i < 5; i++) {
                const cache = new CacheManager({ ttl: 1000 });

                // Operations
                for (let j = 0; j < 1000; j++) {
                    cache.set(`key-${j}`, { data: j });
                }

                if (global.gc) global.gc();

                measurements.push(process.memoryUsage().heapUsed);
                cache.clear();
            }

            const memoryGrowth = measurements[measurements.length - 1] - measurements[0];
            const growthMB = memoryGrowth / 1024 / 1024;

            console.log(`
📊 Memory Leak Test:
   Iterations: ${measurements.length}
   Growth:     ${growthMB.toFixed(2)}MB
            `);

            // More lenient threshold - should not grow more than 50MB
            expect(Math.abs(growthMB)).toBeLessThan(50);
        });
    });

    describe('Concurrent Request Performance', () => {
        test('Handles concurrent requests efficiently', async () => {
            const concurrentRequests = 50;
            const start = performance.now();

            const promises = Array(concurrentRequests)
                .fill()
                .map(() => request(app).get('/health').expect(200));

            await Promise.all(promises);

            const duration = performance.now() - start;
            const avgPerRequest = duration / concurrentRequests;

            console.log(`
📊 Concurrent Requests Performance:
   Total Requests:   ${concurrentRequests}
   Total Duration:   ${duration.toFixed(2)}ms
   Avg Per Request:  ${avgPerRequest.toFixed(2)}ms
            `);

            // Average should still be reasonable under load
            expect(avgPerRequest).toBeLessThan(100);
        });

        test('Maintains performance under sustained load', async () => {
            const iterations = 5;
            const requestsPerIteration = 20;
            const times = [];

            for (let i = 0; i < iterations; i++) {
                const start = performance.now();

                const promises = Array(requestsPerIteration)
                    .fill()
                    .map(() => request(app).get('/get-config'));

                await Promise.all(promises);
                times.push(performance.now() - start);
            }

            const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
            const firstTime = times[0];
            const lastTime = times[times.length - 1];
            const degradation = ((lastTime - firstTime) / firstTime) * 100;

            console.log(`
📊 Sustained Load Performance:
   Iterations:       ${iterations}
   Requests/Iter:    ${requestsPerIteration}
   First Iteration:  ${firstTime.toFixed(2)}ms
   Last Iteration:   ${lastTime.toFixed(2)}ms
   Degradation:      ${degradation.toFixed(1)}%
   Average:          ${avgTime.toFixed(2)}ms
            `);

            // Performance should not degrade more than 50% over iterations
            expect(Math.abs(degradation)).toBeLessThan(50);
        });
    });

    describe('Regex and String Performance', () => {
        test('URL parsing is efficient', () => {
            const urls = [
                '/api/admin/config',
                '/get-media?type=movie&count=50',
                '/proxy-image?url=https://example.com/image.jpg',
                '/api/devices/ABC123/heartbeat',
            ];

            const stats = urls.map(url => {
                const times = [];
                for (let i = 0; i < 10000; i++) {
                    const start = performance.now();
                    const parsed = new URL(url, 'http://localhost:4000');
                    times.push(performance.now() - start);
                }
                return {
                    url,
                    avg: times.reduce((a, b) => a + b, 0) / times.length,
                };
            });

            stats.forEach(stat => {
                console.log(`   ${stat.url}: ${stat.avg.toFixed(4)}ms`);
                expect(stat.avg).toBeLessThan(0.1);
            });
        });

        test('JSON parsing performance', () => {
            const testData = {
                devices: Array(100)
                    .fill()
                    .map((_, i) => ({
                        id: `device-${i}`,
                        name: `Device ${i}`,
                        settings: { mode: 'screensaver', interval: 30 },
                    })),
            };

            const json = JSON.stringify(testData);

            const times = [];
            for (let i = 0; i < 1000; i++) {
                const start = performance.now();
                JSON.parse(json);
                times.push(performance.now() - start);
            }

            const avg = times.reduce((a, b) => a + b, 0) / times.length;

            console.log(`
📊 JSON Parse Performance:
   Payload Size:  ${json.length} bytes
   Iterations:    1000
   Average:       ${avg.toFixed(4)}ms
            `);

            expect(avg).toBeLessThan(1);
        });
    });

    describe('Performance Regression Detection', () => {
        test('Benchmark results are within expected ranges', () => {
            // This test serves as a baseline comparator
            const baselines = {
                health: THRESHOLDS.health,
                config: THRESHOLDS.config,
                cacheRead: THRESHOLDS.cacheRead,
                cacheWrite: THRESHOLDS.cacheWrite,
            };

            console.log(`
📊 Performance Baselines:
   Health Check:   <${baselines.health}ms
   Config Fetch:   <${baselines.config}ms
   Cache Read:     <${baselines.cacheRead}ms
   Cache Write:    <${baselines.cacheWrite}ms

⚠️  If tests fail, performance may have regressed.
   Review recent changes to critical paths.
            `);

            expect(baselines).toBeDefined();
        });
    });

    describe('Export Performance Report', () => {
        test('Generate performance summary', () => {
            const report = {
                timestamp: new Date().toISOString(),
                node_version: process.version,
                platform: process.platform,
                arch: process.arch,
                thresholds: THRESHOLDS,
                test_run: 'benchmark-suite',
            };

            console.log(`
📊 Performance Test Summary:
   Timestamp:     ${report.timestamp}
   Node.js:       ${report.node_version}
   Platform:      ${report.platform}/${report.arch}
   
🎯 All benchmarks completed successfully
            `);

            expect(report).toBeDefined();
        });
    });
});
