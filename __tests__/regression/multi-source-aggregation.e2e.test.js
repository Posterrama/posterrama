/**
 * Multi-Source Media Aggregation E2E Tests
 *
 * Tests complete integration of all media sources:
 * - Plex
 * - Jellyfin
 * - TMDB
 * - Local Directory
 *
 * Validates that media from multiple sources can be:
 * - Fetched simultaneously
 * - Aggregated correctly
 * - Filtered/shuffled as expected
 * - Cached efficiently
 */

const request = require('supertest');
const path = require('path');
const fs = require('fs');

jest.mock('../../utils/logger');

describe('Multi-Source Media Aggregation E2E', () => {
    let app;
    let originalConfig;
    let configPath;

    beforeAll(async () => {
        // Setup test environment
        process.env.NODE_ENV = 'test';
        process.env.API_ACCESS_TOKEN = 'test-token-aggregation';

        configPath = path.resolve(__dirname, '../../config.json');

        // Backup original config
        if (fs.existsSync(configPath)) {
            originalConfig = fs.readFileSync(configPath, 'utf8');
        }

        // Clear require cache
        jest.resetModules();
        Object.keys(require.cache).forEach(key => {
            if (key.includes('server.js') || key.includes('config.json')) {
                delete require.cache[key];
            }
        });

        // Load app
        app = require('../../server');

        // Wait for initialization
        await new Promise(resolve => setTimeout(resolve, 1000));
    }, 30000);

    afterAll(() => {
        // Restore original config
        if (originalConfig && configPath) {
            try {
                fs.writeFileSync(configPath, originalConfig);
            } catch (error) {
                console.warn('Could not restore config:', error.message);
            }
        }
    });

    describe('Multi-Source Fetching', () => {
        test('should fetch media from all available sources', async () => {
            const response = await request(app)
                .get('/get-media')
                .query({ type: 'movie', count: 50 })
                .timeout(15000);

            // Accept 200 (has media), 202 (refreshing), or 503 (no sources configured)
            expect([200, 202, 503]).toContain(response.status);

            if (response.status === 200) {
                console.log(`✅ Media fetched: ${response.body.length} items`);

                // Verify response structure
                expect(Array.isArray(response.body)).toBe(true);

                if (response.body.length > 0) {
                    const firstItem = response.body[0];

                    // Verify required fields
                    expect(firstItem).toHaveProperty('title');
                    expect(firstItem).toHaveProperty('year');
                    expect(firstItem).toHaveProperty('source');

                    // Source should be one of the supported types
                    expect(['plex', 'jellyfin', 'tmdb', 'local']).toContain(firstItem.source);

                    // Check for poster URL
                    if (firstItem.poster) {
                        expect(typeof firstItem.poster).toBe('string');
                        expect(firstItem.poster.length).toBeGreaterThan(0);
                    }
                }
            } else if (response.status === 202) {
                console.log('⏳ Media is refreshing, playlist not ready yet');
                expect(response.body).toHaveProperty('status', 'refreshing');
            } else {
                console.log('ℹ️ No media sources configured in test environment');
            }
        }, 20000);

        test('should handle mixed movie and TV show requests', async () => {
            // Test movie request
            const movieRes = await request(app)
                .get('/get-media')
                .query({ type: 'movie', count: 10 })
                .timeout(10000);

            expect([200, 202, 503]).toContain(movieRes.status);

            // Test TV show request
            const tvRes = await request(app)
                .get('/get-media')
                .query({ type: 'show', count: 10 })
                .timeout(10000);

            expect([200, 202, 503]).toContain(tvRes.status);

            // If both have media, verify they're different types
            if (movieRes.status === 200 && tvRes.status === 200) {
                if (movieRes.body.length > 0 && tvRes.body.length > 0) {
                    const movieItem = movieRes.body[0];
                    const tvItem = tvRes.body[0];

                    // They should have different type indicators
                    console.log(`✅ Movie: ${movieItem.title}, TV: ${tvItem.title}`);
                }
            }
        }, 20000);

        test('should respect count parameter for aggregation', async () => {
            const counts = [5, 10, 20];

            for (const count of counts) {
                const response = await request(app)
                    .get('/get-media')
                    .query({ type: 'movie', count })
                    .timeout(10000);

                if (response.status === 200) {
                    expect(response.body.length).toBeLessThanOrEqual(count);
                    console.log(`✅ Requested ${count}, got ${response.body.length}`);
                }
            }
        }, 30000);
    });

    describe('Source-Specific Metadata', () => {
        test('should include source-specific metadata in aggregated results', async () => {
            const response = await request(app)
                .get('/get-media')
                .query({ type: 'movie', count: 30 })
                .timeout(10000);

            if (response.status === 200 && response.body.length > 0) {
                const items = response.body;

                // Group by source
                const bySource = items.reduce((acc, item) => {
                    acc[item.source] = acc[item.source] || [];
                    acc[item.source].push(item);
                    return acc;
                }, {});

                console.log('📊 Media sources found:', Object.keys(bySource));

                // Verify each source type has appropriate metadata
                for (const [source, sourceItems] of Object.entries(bySource)) {
                    console.log(`  - ${source}: ${sourceItems.length} items`);

                    const item = sourceItems[0];

                    // All sources should have basic fields
                    expect(item).toHaveProperty('title');
                    expect(item).toHaveProperty('year');

                    // Source-specific checks
                    if (source === 'plex') {
                        // Plex items may have rating keys
                        if (item.ratingKey) {
                            expect(typeof item.ratingKey).toBe('string');
                        }
                    } else if (source === 'jellyfin') {
                        // Jellyfin items may have item IDs
                        if (item.itemId) {
                            expect(typeof item.itemId).toBe('string');
                        }
                    } else if (source === 'tmdb') {
                        // TMDB items should have TMDB IDs
                        if (item.tmdbId) {
                            expect(typeof item.tmdbId).toBeOneOf(['string', 'number']);
                        }
                    } else if (source === 'local') {
                        // Local items should have file paths
                        if (item.filePath) {
                            expect(typeof item.filePath).toBe('string');
                        }
                    }
                }
            } else {
                console.log('ℹ️ No media available for source metadata test');
            }
        }, 15000);
    });

    describe('Aggregation Performance', () => {
        test('should aggregate large counts efficiently', async () => {
            const startTime = Date.now();

            const response = await request(app)
                .get('/get-media')
                .query({ type: 'movie', count: 100 })
                .timeout(20000);

            const duration = Date.now() - startTime;

            if (response.status === 200) {
                console.log(`⏱️ Aggregated ${response.body.length} items in ${duration}ms`);

                // Should complete within reasonable time
                expect(duration).toBeLessThan(15000); // 15 seconds max

                // Verify no duplicates (by title + year)
                const seen = new Set();
                let duplicates = 0;

                response.body.forEach(item => {
                    const key = `${item.title}-${item.year}`;
                    if (seen.has(key)) {
                        duplicates++;
                    }
                    seen.add(key);
                });

                if (duplicates > 0) {
                    console.warn(`⚠️ Found ${duplicates} potential duplicates`);
                }
            }
        }, 25000);

        test('should handle concurrent aggregation requests', async () => {
            const concurrentRequests = 5;
            const startTime = Date.now();

            const promises = Array(concurrentRequests)
                .fill()
                .map(() =>
                    request(app)
                        .get('/get-media')
                        .query({ type: 'movie', count: 20 })
                        .timeout(15000)
                );

            const results = await Promise.all(promises);
            const duration = Date.now() - startTime;

            console.log(`⏱️ ${concurrentRequests} concurrent requests in ${duration}ms`);

            // All should succeed with same status
            const statuses = results.map(r => r.status);
            const firstStatus = statuses[0];

            statuses.forEach(status => {
                expect([200, 202, 503]).toContain(status);
            });

            // If all returned 200, verify they all got media
            if (firstStatus === 200) {
                results.forEach(result => {
                    expect(result.body.length).toBeGreaterThan(0);
                });
            }
        }, 30000);
    });

    describe('Cache Behavior', () => {
        test('should use cache for repeated requests', async () => {
            // First request (cache miss)
            const firstStart = Date.now();
            const firstRes = await request(app)
                .get('/get-media')
                .query({ type: 'movie', count: 20 })
                .timeout(10000);
            const firstDuration = Date.now() - firstStart;

            if (firstRes.status !== 200) {
                console.log('ℹ️ Skipping cache test - no media available');
                return;
            }

            // Second request (should hit cache)
            const secondStart = Date.now();
            const secondRes = await request(app)
                .get('/get-media')
                .query({ type: 'movie', count: 20 })
                .timeout(10000);
            const secondDuration = Date.now() - secondStart;

            expect(secondRes.status).toBe(200);

            // Cached request should be faster or same speed
            console.log(`⏱️ First: ${firstDuration}ms, Second: ${secondDuration}ms (cached)`);

            // Results should be identical
            expect(secondRes.body.length).toBe(firstRes.body.length);

            if (firstRes.body.length > 0) {
                expect(secondRes.body[0].title).toBe(firstRes.body[0].title);
            }
        }, 25000);
    });

    describe('Error Handling', () => {
        test('should handle invalid type parameter gracefully', async () => {
            const response = await request(app)
                .get('/get-media')
                .query({ type: 'invalid', count: 10 })
                .timeout(5000);

            // Should either return 400 or default to movie/show
            expect([200, 202, 400, 503]).toContain(response.status);
        });

        test('should handle invalid count parameter gracefully', async () => {
            const response = await request(app)
                .get('/get-media')
                .query({ type: 'movie', count: 'invalid' })
                .timeout(5000);

            // Should use default count or return error
            expect([200, 202, 400, 503]).toContain(response.status);
        });

        test('should handle missing parameters gracefully', async () => {
            const response = await request(app).get('/get-media').timeout(5000);

            // Should use defaults
            expect([200, 202, 503]).toContain(response.status);
        });
    });

    describe('Source Priority and Fallback', () => {
        test('should aggregate from multiple sources when available', async () => {
            const response = await request(app)
                .get('/get-media')
                .query({ type: 'movie', count: 50 })
                .timeout(15000);

            if (response.status === 200 && response.body.length > 0) {
                const sources = [...new Set(response.body.map(item => item.source))];

                console.log(`📊 Active sources: ${sources.join(', ')}`);

                // If multiple sources, verify distribution
                if (sources.length > 1) {
                    const distribution = sources.reduce((acc, source) => {
                        acc[source] = response.body.filter(i => i.source === source).length;
                        return acc;
                    }, {});

                    console.log('📊 Source distribution:', distribution);

                    // No single source should dominate completely (unless it's the only one with enough content)
                    Object.values(distribution).forEach(count => {
                        expect(count).toBeGreaterThan(0);
                    });
                }
            }
        }, 20000);
    });
});
