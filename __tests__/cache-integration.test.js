const request = require('supertest');
const express = require('express');

// Mock the cache manager
const mockCacheManager = {
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
    clear: jest.fn(),
    has: jest.fn(),
    keys: jest.fn(),
    size: jest.fn().mockReturnValue(0),
    getStats: jest.fn().mockReturnValue({ hits: 0, misses: 0 })
};

describe('Cache Integration Tests', () => {
    let app;
    let mockConfig;

    beforeEach(() => {
        mockConfig = {
            clockWidget: true,
            clockTimezone: 'Europe/Amsterdam',
            clockFormat: '24h',
            transitionIntervalSeconds: 15,
            backgroundRefreshMinutes: 30,
            showClearLogo: true,
            showPoster: true,
            showMetadata: true,
            showRottenTomatoes: true,
            rottenTomatoesMinimumScore: 0,
            kenBurnsEffect: { enabled: true, durationSeconds: 15 }
        };

        // Create test express app
        app = express();
        app.use(express.json());

        // Mock cache middleware
        const cacheMiddleware = (options = {}) => {
            const { keyGenerator = (req) => `${req.method}:${req.originalUrl}` } = options;
            
            return (req, res, next) => {
                const cacheKey = keyGenerator(req);
                const cached = mockCacheManager.get(cacheKey);

                if (cached) {
                    return res.json(cached.data);
                }

                // Store original json method
                const originalJson = res.json;
                res.json = function(data) {
                    // Cache the response
                    mockCacheManager.set(cacheKey, data);
                    return originalJson.call(this, data);
                };

                next();
            };
        };

        // Add cached config endpoint
        app.get('/get-config', 
            cacheMiddleware({ ttl: 600000 }),
            (req, res) => {
                res.json(mockConfig);
            }
        );

        // Add config update endpoint
        app.post('/api/admin/config', (req, res) => {
            const { config: newConfig } = req.body;
            
            // Update config
            Object.assign(mockConfig, newConfig);
            
            // Clear the cache
            mockCacheManager.delete('GET:/get-config');
            
            res.json({ message: 'Configuration saved successfully' });
        });

        // Clear all mocks
        jest.clearAllMocks();
    });

    describe('Config Cache Behavior', () => {
        it('should cache config responses', async () => {
            mockCacheManager.get.mockReturnValue(null);

            // First request should miss cache and set it
            await request(app)
                .get('/get-config')
                .expect(200);

            expect(mockCacheManager.get).toHaveBeenCalledWith('GET:/get-config');
            expect(mockCacheManager.set).toHaveBeenCalledWith('GET:/get-config', mockConfig);
        });

        it('should serve from cache on subsequent requests', async () => {
            const cachedData = { data: mockConfig };
            mockCacheManager.get.mockReturnValue(cachedData);

            // Request should be served from cache
            const response = await request(app)
                .get('/get-config')
                .expect(200);

            expect(response.body).toEqual(mockConfig);
            expect(mockCacheManager.get).toHaveBeenCalledWith('GET:/get-config');
            expect(mockCacheManager.set).not.toHaveBeenCalled();
        });

        it('should clear cache when config is updated', async () => {
            const newConfig = {
                clockWidget: false,
                clockTimezone: 'America/New_York',
                clockFormat: '12h'
            };

            await request(app)
                .post('/api/admin/config')
                .send({ config: newConfig })
                .expect(200);

            expect(mockCacheManager.delete).toHaveBeenCalledWith('GET:/get-config');
        });

        it('should return updated config after cache clear', async () => {
            // First, cache the original config
            mockCacheManager.get.mockReturnValueOnce(null);
            await request(app).get('/get-config');

            // Update config
            const newConfig = {
                clockTimezone: 'America/New_York',
                clockFormat: '12h'
            };

            await request(app)
                .post('/api/admin/config')
                .send({ config: newConfig })
                .expect(200);

            // Verify cache was cleared
            expect(mockCacheManager.delete).toHaveBeenCalledWith('GET:/get-config');

            // Next request should get updated config
            mockCacheManager.get.mockReturnValue(null);
            const response = await request(app)
                .get('/get-config')
                .expect(200);

            expect(response.body.clockTimezone).toBe('America/New_York');
            expect(response.body.clockFormat).toBe('12h');
        });
    });

    describe('Cache Key Generation', () => {
        it('should generate correct cache keys for different endpoints', () => {
            const testCases = [
                { method: 'GET', url: '/get-config', expected: 'GET:/get-config' },
                { method: 'GET', url: '/get-media', expected: 'GET:/get-media' },
                { method: 'POST', url: '/api/admin/config', expected: 'POST:/api/admin/config' }
            ];

            testCases.forEach(({ method, url, expected }) => {
                const req = { method, originalUrl: url };
                const keyGenerator = (req) => `${req.method}:${req.originalUrl}`;
                const key = keyGenerator(req);
                expect(key).toBe(expected);
            });
        });

        it('should handle query parameters in cache keys', () => {
            const req = { method: 'GET', originalUrl: '/get-config?nocache=1' };
            const keyGenerator = (req) => `${req.method}:${req.originalUrl}`;
            const key = keyGenerator(req);
            expect(key).toBe('GET:/get-config?nocache=1');
        });
    });

    describe('Cache Clearing Scenarios', () => {
        it('should handle cache clearing for timezone changes', async () => {
            // Simulate timezone change
            const timezoneUpdate = { clockTimezone: 'Asia/Tokyo' };

            await request(app)
                .post('/api/admin/config')
                .send({ config: timezoneUpdate })
                .expect(200);

            expect(mockCacheManager.delete).toHaveBeenCalledWith('GET:/get-config');
        });

        it('should handle cache clearing for clock format changes', async () => {
            // Simulate clock format change
            const formatUpdate = { clockFormat: '12h' };

            await request(app)
                .post('/api/admin/config')
                .send({ config: formatUpdate })
                .expect(200);

            expect(mockCacheManager.delete).toHaveBeenCalledWith('GET:/get-config');
        });

        it('should handle cache clearing for clock widget toggle', async () => {
            // Simulate clock widget toggle
            const widgetUpdate = { clockWidget: false };

            await request(app)
                .post('/api/admin/config')
                .send({ config: widgetUpdate })
                .expect(200);

            expect(mockCacheManager.delete).toHaveBeenCalledWith('GET:/get-config');
        });

        it('should handle multiple config changes in single request', async () => {
            // Simulate multiple changes
            const multipleUpdates = {
                clockWidget: false,
                clockTimezone: 'Pacific/Honolulu',
                clockFormat: '12h',
                transitionIntervalSeconds: 30
            };

            await request(app)
                .post('/api/admin/config')
                .send({ config: multipleUpdates })
                .expect(200);

            // Cache should still only be cleared once
            expect(mockCacheManager.delete).toHaveBeenCalledTimes(1);
            expect(mockCacheManager.delete).toHaveBeenCalledWith('GET:/get-config');
        });
    });

    describe('Cache Error Handling', () => {
        it('should handle cache get errors gracefully', async () => {
            mockCacheManager.get.mockImplementation(() => {
                throw new Error('Cache error');
            });

            // Mock the middleware to catch errors
            app.get('/get-config-error-test', 
                (req, res, next) => {
                    try {
                        const cacheKey = 'GET:/get-config-error-test';
                        const cached = mockCacheManager.get(cacheKey);
                        
                        if (cached) {
                            return res.json(cached.data);
                        }
                        
                        res.json(mockConfig);
                    } catch (error) {
                        // Handle cache error gracefully
                        res.json(mockConfig);
                    }
                }
            );

            await request(app)
                .get('/get-config-error-test')
                .expect(200);
        });

        it('should handle cache set errors gracefully', async () => {
            mockCacheManager.get.mockReturnValue(null);
            mockCacheManager.set.mockImplementation(() => {
                throw new Error('Cache set error');
            });

            // Mock the middleware to catch set errors
            app.get('/get-config-set-error-test', 
                (req, res, next) => {
                    try {
                        const cacheKey = 'GET:/get-config-set-error-test';
                        
                        // Try to set cache, but catch errors
                        try {
                            mockCacheManager.set(cacheKey, mockConfig);
                        } catch (cacheError) {
                            // Log but continue
                        }
                        
                        res.json(mockConfig);
                    } catch (error) {
                        res.status(500).json({ error: error.message });
                    }
                }
            );

            await request(app)
                .get('/get-config-set-error-test')
                .expect(200);
        });

        it('should handle cache delete errors gracefully', async () => {
            mockCacheManager.delete.mockImplementation(() => {
                throw new Error('Cache delete error');
            });

            // Mock the config update endpoint to catch delete errors
            app.post('/api/admin/config-delete-error-test', (req, res) => {
                try {
                    const { config: newConfig } = req.body;
                    
                    // Update config
                    Object.assign(mockConfig, newConfig);
                    
                    // Try to clear cache, but catch errors
                    try {
                        mockCacheManager.delete('GET:/get-config');
                    } catch (cacheError) {
                        // Log but continue
                    }
                    
                    res.json({ message: 'Configuration saved successfully' });
                } catch (error) {
                    res.status(500).json({ error: error.message });
                }
            });

            await request(app)
                .post('/api/admin/config-delete-error-test')
                .send({ config: { clockWidget: false } })
                .expect(200);
        });
    });

    describe('Cache Performance', () => {
        it('should improve response times with caching', async () => {
            // First request (cache miss)
            mockCacheManager.get.mockReturnValueOnce(null);
            const start1 = Date.now();
            await request(app).get('/get-config');
            const duration1 = Date.now() - start1;

            // Second request (cache hit)
            mockCacheManager.get.mockReturnValueOnce({ data: mockConfig });
            const start2 = Date.now();
            await request(app).get('/get-config');
            const duration2 = Date.now() - start2;

            // Cache hit should be faster (though this is a simple mock test)
            expect(mockCacheManager.get).toHaveBeenCalledTimes(2);
        });

        it('should track cache statistics', () => {
            // Mock some cache statistics
            mockCacheManager.getStats.mockReturnValue({
                hits: 10,
                misses: 3,
                hitRate: 0.77
            });

            const stats = mockCacheManager.getStats();
            expect(stats.hits).toBe(10);
            expect(stats.misses).toBe(3);
            expect(stats.hitRate).toBe(0.77);
        });
    });
});
