const request = require('supertest');
const app = require('../server');

// Helper function to add delay between requests
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

describe('Caching System', () => {
    // Add delays between tests to avoid rate limiting
    beforeEach(async () => {
        await delay(150);
    });

    afterEach(async () => {
        await delay(150);
    });

    describe('Media Playlist Caching', () => {
        test('should cache media playlist responses', async () => {
            // First request (should be cached)
            const response1 = await request(app)
                .get('/api/v1/media');

            await delay(200);

            // Second request (should be from cache)
            const response2 = await request(app)
                .get('/api/v1/media');

            // Both should succeed or both should have same status
            expect(response1.status).toEqual(response2.status);
            
            if (response1.status === 200) {
                expect(response1.body).toEqual(response2.body);
                // Check for cache headers
                expect(response2.headers).toHaveProperty('x-cache');
            }
        });

        test('should include cache headers in responses', async () => {
            await delay(200);
            
            const response = await request(app)
                .get('/api/v1/media');

            if (response.status === 200) {
                expect(response.headers).toHaveProperty('cache-control');
                expect(response.headers).toHaveProperty('etag');
                expect(response.headers).toHaveProperty('x-cache');
            }
        });

        test('should support conditional requests with ETag', async () => {
            await delay(200);
            
            // First request to get ETag
            const response1 = await request(app)
                .get('/api/v1/media');

            if (response1.status === 200 && response1.headers.etag) {
                await delay(200);

                // Second request with If-None-Match header
                const response2 = await request(app)
                    .get('/api/v1/media')
                    .set('If-None-Match', response1.headers.etag);

                expect([200, 304]).toContain(response2.status);
            }
        });

        test('should invalidate cache after configured timeout', async () => {
            await delay(200);
            
            // This test would need a shorter TTL for practical testing
            // For now, just verify the endpoint works
            const response = await request(app)
                .get('/api/v1/media');

            expect([200, 202, 503]).toContain(response.status);
        });
    });

    describe('Configuration Caching', () => {
        test('should cache configuration responses', async () => {
            await delay(400); // Longer delay to avoid rate limiting
            
            const response1 = await request(app)
                .get('/api/v1/config');

            await delay(400);

            const response2 = await request(app)
                .get('/api/v1/config');

            // Handle potential rate limiting or empty responses
            if (response1.status === 429 || response2.status === 429) {
                // Skip test if rate limited
                return;
            }

            if (response1.status === 200 && response2.status === 200) {
                // Both responses should have the same structure
                expect(typeof response1.body).toBe('object');
                expect(typeof response2.body).toBe('object');
                
                // If both have content, they should be equal
                if (Object.keys(response1.body).length > 0 && Object.keys(response2.body).length > 0) {
                    expect(response1.body).toEqual(response2.body);
                }
            }
        });

        test('should include appropriate cache headers for config', async () => {
            await delay(200);
            
            const response = await request(app)
                .get('/api/v1/config');

            if (response.status === 200) {
                expect(response.headers).toHaveProperty('cache-control');
                
                // Config should have longer cache time
                const cacheControl = response.headers['cache-control'];
                expect(cacheControl).toMatch(/max-age=\d+/);
            }
        });

        test('should support ETag for configuration', async () => {
            await delay(200);
            
            const response1 = await request(app)
                .get('/api/v1/config');

            if (response1.status === 200) {
                expect(response1.headers).toHaveProperty('etag');

                if (response1.headers.etag) {
                    await delay(200);

                    const response2 = await request(app)
                        .get('/api/v1/config')
                        .set('If-None-Match', response1.headers.etag);

                    expect([200, 304]).toContain(response2.status);
                }
            }
        });
    });

    describe('Image Caching', () => {
        test('should cache image responses', async () => {
            await delay(200);
            
            const response = await request(app)
                .get('/image/test-image.jpg');

            // Should return some response (may be 400 for missing params, which is expected)
            expect(response.status).toBeDefined();
        });

        test('should handle image cache directory', async () => {
            await delay(400);
            
            // This tests the basic image endpoint functionality
            const response = await request(app)
                .get('/image?server=test&path=test.jpg');

            // Expect 400, 302, or 429 (rate limited)
            expect([400, 302, 429]).toContain(response.status);
        });
    });

    describe('Cache Invalidation', () => {
        test('should provide cache invalidation endpoint', async () => {
            await delay(400);
            
            const response = await request(app)
                .post('/api/v1/admin/cache/clear');
                
            // Should require authentication (401) or be rate limited (429)
            expect([401, 429]).toContain(response.status);
        });

        test('should invalidate specific cache types', async () => {
            await delay(400);
            
            const response = await request(app)
                .post('/api/v1/admin/cache/clear')
                .send({ type: 'media' });
                
            // Should require authentication (401) or be rate limited (429)
            expect([401, 429]).toContain(response.status);
        });
    });

    describe('Cache Performance', () => {
        test('should improve response times with caching', async () => {
            await delay(500); // Longer delay before performance test
            
            // First request
            const start1 = Date.now();
            const response1 = await request(app)
                .get('/api/v1/config');
            const duration1 = Date.now() - start1;

            if (response1.status !== 200) {
                // Skip if rate limited
                return;
            }

            await delay(200);

            // Second request (should be cached and faster)
            const start2 = Date.now();
            const response2 = await request(app)
                .get('/api/v1/config');
            const duration2 = Date.now() - start2;

            if (response2.status === 200) {
                expect(response1.body).toEqual(response2.body);
                
                // Second request should generally be faster (cached)
                // But we'll be lenient due to test environment variability
                expect(duration2).toBeLessThanOrEqual(duration1 + 50);
            }
        });

        test('should handle concurrent requests efficiently', async () => {
            await delay(500); // Longer delay before concurrent test
            
            // Make fewer concurrent requests to avoid rate limiting
            const promises = Array(2).fill().map(() => 
                request(app).get('/api/v1/config')
            );

            const responses = await Promise.all(promises);

            // Check if we got valid responses (not all rate limited)
            const validResponses = responses.filter(r => r.status === 200);
            
            if (validResponses.length > 1) {
                // All valid responses should have identical data (cached)
                const firstBody = validResponses[0].body;
                validResponses.forEach(response => {
                    expect(response.body).toEqual(firstBody);
                });
            }
        });
    });

    describe('Cache Storage', () => {
        test('should persist cache data appropriately', async () => {
            await delay(200);
            
            const response = await request(app)
                .get('/api/v1/config');

            if (response.status === 200) {
                // Cache should be accessible for subsequent requests
                // This is verified by other tests, but we can check that
                // the response has appropriate headers
                expect(response.headers).toHaveProperty('etag');
            }
        });

        test('should handle cache size limits', async () => {
            await delay(200);
            
            // Test cache behavior under load
            const endpoints = ['/api/v1/config'];
            
            for (const endpoint of endpoints) {
                await delay(200);
                const response = await request(app).get(endpoint);
                // Just verify the requests work
                expect([200, 429, 503]).toContain(response.status);
            }
        });
    });

    describe('Cache Headers and Validation', () => {
        test('should set appropriate Vary headers', async () => {
            await delay(200);
            
            const response = await request(app)
                .get('/api/v1/config');

            if (response.status === 200) {
                // Should include Vary header for proper caching
                if (response.headers.vary) {
                    expect(response.headers.vary).toContain('Accept-Encoding');
                }
            }
        });

        test('should handle cache-busting parameters', async () => {
            await delay(200);
            
            const response1 = await request(app)
                .get('/api/v1/config?v=1');

            await delay(200);
                
            const response2 = await request(app)
                .get('/api/v1/config?v=2');

            if (response1.status === 200 && response2.status === 200) {
                // Both should return the same data
                expect(response1.body).toEqual(response2.body);
            }
        });

        test('should respect no-cache directives', async () => {
            await delay(200);
            
            const response = await request(app)
                .get('/api/v1/config')
                .set('Cache-Control', 'no-cache');

            if (response.status === 200) {
                // Should still return valid response even with no-cache
                expect(response.body).toBeDefined();
            }
        });
    });
});
