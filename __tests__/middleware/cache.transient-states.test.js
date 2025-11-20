/**
 * @jest-environment node
 */

const { cacheMiddleware, apiCache } = require('../../middleware/cache');

describe('API Cache - Transient State Handling', () => {
    beforeEach(() => {
        apiCache.clear();
        apiCache.resetStats();
    });

    afterEach(() => {
        apiCache.clear();
    });

    describe('Building status responses', () => {
        it('should NOT cache responses with status="building"', done => {
            const req = {
                method: 'GET',
                url: '/get-media',
                query: { count: 1, excludeGames: '1' },
            };
            const res = {
                statusCode: 200,
                set: jest.fn(),
                json: function (data) {
                    return data;
                },
            };

            const middleware = cacheMiddleware.media;
            const next = jest.fn();

            // Execute middleware
            middleware(req, res, next);

            // Simulate response with "building" status
            const buildingResponse = {
                status: 'building',
                message: 'Playlist is being built',
                retryIn: 2000,
            };

            res.json(buildingResponse);

            // Verify cache was skipped
            setTimeout(() => {
                expect(res.set).toHaveBeenCalledWith('X-Cache', 'SKIP');

                // Verify the response is not in cache
                const cacheKey = apiCache.generateKey(req);
                const cached = apiCache.get(cacheKey);
                expect(cached).toBeNull();

                // Verify stats show cache miss (not a cache set)
                const stats = apiCache.getStats();
                expect(stats.sets).toBe(0);

                done();
            }, 50);
        });

        it('should NOT cache responses with status="failed"', done => {
            const req = {
                method: 'GET',
                url: '/get-media',
                query: { count: 1 },
            };
            const res = {
                statusCode: 200,
                set: jest.fn(),
                json: function (data) {
                    return data;
                },
            };

            const middleware = cacheMiddleware.media;
            const next = jest.fn();

            middleware(req, res, next);

            const failedResponse = {
                status: 'failed',
                error: 'Media playlist is currently unavailable',
            };

            res.json(failedResponse);

            setTimeout(() => {
                expect(res.set).toHaveBeenCalledWith('X-Cache', 'SKIP');

                const cacheKey = apiCache.generateKey(req);
                const cached = apiCache.get(cacheKey);
                expect(cached).toBeNull();

                done();
            }, 50);
        });

        it('SHOULD cache successful array responses', done => {
            const req = {
                method: 'GET',
                url: '/get-media',
                query: { count: 1 },
            };
            const res = {
                statusCode: 200,
                set: jest.fn(),
                json: function (data) {
                    return data;
                },
            };

            const middleware = cacheMiddleware.media;
            const next = jest.fn();

            middleware(req, res, next);

            const successResponse = [
                { id: 1, title: 'Movie 1' },
                { id: 2, title: 'Movie 2' },
            ];

            res.json(successResponse);

            setTimeout(() => {
                expect(res.set).toHaveBeenCalledWith('X-Cache', 'MISS');

                const cacheKey = apiCache.generateKey(req);
                const cached = apiCache.get(cacheKey);
                expect(cached).toEqual(successResponse);

                done();
            }, 50);
        });
    });

    describe('Cache hit behavior', () => {
        it('should serve from cache on second request when response was successful', done => {
            const req = {
                method: 'GET',
                url: '/get-media',
                query: { count: 1 },
            };

            // First request - cache miss
            const res1 = {
                statusCode: 200,
                set: jest.fn(),
                json: function (data) {
                    return data;
                },
            };

            const middleware = cacheMiddleware.media;
            const next1 = jest.fn();

            middleware(req, res1, next1);
            const data = [{ id: 1, title: 'Movie' }];
            res1.json(data);

            setTimeout(() => {
                // Second request - should be cache hit
                const res2 = {
                    statusCode: 200,
                    set: jest.fn(),
                    json: jest.fn(function (responseData) {
                        return responseData;
                    }),
                };

                const next2 = jest.fn();

                middleware(req, res2, next2);

                // Middleware should NOT call next() on cache hit
                expect(next2).not.toHaveBeenCalled();
                expect(res2.json).toHaveBeenCalledWith(data);
                expect(res2.set).toHaveBeenCalledWith('X-Cache', 'HIT');

                done();
            }, 50);
        });
    });

    describe('Real-world scenario: excludeGames parameter', () => {
        it('should not cache building status during startup, then cache successful response', done => {
            const req = {
                method: 'GET',
                url: '/get-media',
                query: { count: 1, excludeGames: '1' },
            };

            // Simulate initial request during startup (playlist building)
            const resDuringStartup = {
                statusCode: 200,
                set: jest.fn(),
                json: function (data) {
                    return data;
                },
            };

            const middleware = cacheMiddleware.media;
            middleware(req, resDuringStartup, jest.fn());

            resDuringStartup.json({
                status: 'building',
                message: 'Playlist is being built',
            });

            setTimeout(() => {
                // Verify building response was not cached
                const cacheKey = apiCache.generateKey(req);
                expect(apiCache.get(cacheKey)).toBeNull();

                // Simulate second request after playlist is ready
                const resAfterLoad = {
                    statusCode: 200,
                    set: jest.fn(),
                    json: function (data) {
                        return data;
                    },
                };

                middleware(req, resAfterLoad, jest.fn());

                const successData = [
                    { id: 1, title: 'Movie 1', type: 'movie' },
                    { id: 2, title: 'Movie 2', type: 'movie' },
                ];

                resAfterLoad.json(successData);

                setTimeout(() => {
                    // Verify successful response IS cached
                    const cached = apiCache.get(cacheKey);
                    expect(cached).toEqual(successData);
                    expect(resAfterLoad.set).toHaveBeenCalledWith('X-Cache', 'MISS');

                    done();
                }, 50);
            }, 50);
        });
    });
});
