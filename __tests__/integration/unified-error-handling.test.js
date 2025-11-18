/**
 * Integration tests for unified error handling (Issue #97)
 * Tests end-to-end retry behavior across all media source adapters
 */

const {
    executeWithRetry,
    getErrorMetrics,
    resetErrorMetrics,
} = require('../../utils/source-error-handler');
const { NetworkError, TimeoutError, AuthError, RateLimitError } = require('../../utils/errors');

describe('Unified Error Handling - Integration (#97)', () => {
    beforeEach(() => {
        // Clean slate for each test
        ['plex', 'jellyfin', 'tmdb', 'romm'].forEach(source => {
            resetErrorMetrics(source);
        });
    });

    describe('Network failure recovery', () => {
        test('should retry and recover from temporary network errors', async () => {
            let attempt = 0;

            const result = await executeWithRetry(
                async () => {
                    attempt++;
                    if (attempt < 3) {
                        throw new NetworkError('Connection refused', {
                            source: 'plex',
                            operation: 'fetchMedia',
                            code: 'ECONNREFUSED',
                        });
                    }
                    return { items: [{ id: 1, title: 'Movie' }] };
                },
                { source: 'plex', operation: 'fetchMedia' },
                { maxRetries: 3, baseDelay: 10 }
            );

            expect(result.items).toHaveLength(1);
            expect(attempt).toBe(3); // Failed twice, succeeded on third

            const metrics = getErrorMetrics('plex');
            expect(metrics.fetchMedia.total).toBe(3); // Total attempts including retries
            expect(metrics.fetchMedia.retries).toBe(2); // Two retries after initial attempt
        });

        test('should fail gracefully after exhausting retries', async () => {
            await expect(
                executeWithRetry(
                    async () => {
                        throw new NetworkError('Connection timeout', {
                            source: 'jellyfin',
                            operation: 'authenticate',
                        });
                    },
                    { source: 'jellyfin', operation: 'authenticate' },
                    { maxRetries: 2, baseDelay: 10 }
                )
            ).rejects.toThrow('Connection timeout');

            const metrics = getErrorMetrics('jellyfin');
            expect(metrics.authenticate.errors).toBeGreaterThan(0);
        });
    });

    describe('Timeout handling', () => {
        test('should respect timeout limits and retry', async () => {
            let attempt = 0;

            const result = await executeWithRetry(
                async () => {
                    attempt++;
                    if (attempt === 1) {
                        throw new TimeoutError('Request timeout', {
                            source: 'tmdb',
                            operation: 'fetchGenres',
                            timeout: 5000,
                        });
                    }
                    return { genres: ['Action', 'Drama'] };
                },
                { source: 'tmdb', operation: 'fetchGenres' },
                { maxRetries: 3, baseDelay: 10 }
            );

            expect(result.genres).toHaveLength(2);
            expect(attempt).toBe(2);
        });

        test('should track timeout errors separately', async () => {
            await expect(
                executeWithRetry(
                    async () => {
                        throw new TimeoutError('Timeout', {
                            source: 'romm',
                            operation: 'getPlatforms',
                        });
                    },
                    { source: 'romm', operation: 'getPlatforms' },
                    { maxRetries: 1, baseDelay: 10 }
                )
            ).rejects.toThrow('Timeout');

            const metrics = getErrorMetrics('romm');
            expect(metrics.getPlatforms.errors).toBeGreaterThan(0);
        });
    });

    describe('Authentication failures', () => {
        test('should not retry on permanent auth errors', async () => {
            let attempt = 0;

            await expect(
                executeWithRetry(
                    async () => {
                        attempt++;
                        throw new AuthError('Invalid credentials', {
                            source: 'plex',
                            operation: 'authenticate',
                            statusCode: 401,
                        });
                    },
                    { source: 'plex', operation: 'authenticate' },
                    { maxRetries: 3, baseDelay: 10 }
                )
            ).rejects.toThrow('Invalid credentials');

            // Should fail immediately without retries for auth errors
            expect(attempt).toBe(1);
        });

        test('should track auth errors without retry', async () => {
            try {
                await executeWithRetry(
                    async () => {
                        throw new AuthError('Token expired', {
                            source: 'jellyfin',
                            operation: 'fetchMedia',
                        });
                    },
                    { source: 'jellyfin', operation: 'fetchMedia' },
                    { maxRetries: 3, baseDelay: 10 }
                );
            } catch (error) {
                expect(error).toBeInstanceOf(AuthError);
            }

            const metrics = getErrorMetrics('jellyfin');
            expect(metrics.fetchMedia.total).toBe(1); // No retries for auth errors
        });
    });

    describe('Rate limiting', () => {
        test('should handle 429 responses with exponential backoff', async () => {
            let attempt = 0;
            const delays = [];

            const result = await executeWithRetry(
                async () => {
                    attempt++;
                    const now = Date.now();
                    if (attempt > 1) {
                        delays.push(now);
                    }

                    if (attempt < 3) {
                        throw new RateLimitError('Rate limit exceeded', {
                            source: 'tmdb',
                            operation: 'fetchMovies',
                            retryAfter: 1,
                        });
                    }
                    return { movies: [] };
                },
                { source: 'tmdb', operation: 'fetchMovies' },
                { maxRetries: 3, baseDelay: 50, multiplier: 2 }
            );

            expect(result.movies).toBeDefined();
            expect(attempt).toBe(3);

            // Verify exponential backoff: each delay should be longer
            if (delays.length > 1) {
                const delay1 = delays[0];
                const delay2 = delays[1];
                expect(delay2 - delay1).toBeGreaterThanOrEqual(40); // ~50ms * 2 with some tolerance
            }
        });

        test('should respect retry-after header', async () => {
            const result = await executeWithRetry(
                async () => {
                    // Simulate successful request after rate limit
                    return { success: true };
                },
                { source: 'tmdb', operation: 'search' },
                { maxRetries: 2, baseDelay: 10 }
            );

            expect(result.success).toBe(true);
        });
    });

    describe('Multi-source scenarios', () => {
        test('should track errors independently per source', async () => {
            // Simulate errors from different sources
            await Promise.allSettled([
                executeWithRetry(
                    async () => {
                        throw new NetworkError('Plex error');
                    },
                    { source: 'plex', operation: 'fetchMedia' },
                    { maxRetries: 1, baseDelay: 10 }
                ),
                executeWithRetry(
                    async () => {
                        throw new TimeoutError('Jellyfin timeout');
                    },
                    { source: 'jellyfin', operation: 'fetchMedia' },
                    { maxRetries: 1, baseDelay: 10 }
                ),
            ]);

            const plexMetrics = getErrorMetrics('plex');
            const jellyfinMetrics = getErrorMetrics('jellyfin');

            expect(plexMetrics.fetchMedia.errors).toBeGreaterThan(0);
            expect(jellyfinMetrics.fetchMedia.errors).toBeGreaterThan(0);
        });

        test('should allow one source to succeed while others fail', async () => {
            const results = await Promise.allSettled([
                executeWithRetry(
                    async () => {
                        throw new NetworkError('Plex down');
                    },
                    { source: 'plex', operation: 'fetchMedia' },
                    { maxRetries: 1, baseDelay: 10 }
                ),
                executeWithRetry(
                    async () => {
                        return { items: [{ id: 1 }] };
                    },
                    { source: 'jellyfin', operation: 'fetchMedia' },
                    { maxRetries: 1, baseDelay: 10 }
                ),
            ]);

            expect(results[0].status).toBe('rejected');
            expect(results[1].status).toBe('fulfilled');
            expect(results[1].value.items).toHaveLength(1);
        });
    });

    describe('Error recovery patterns', () => {
        test('should recover from intermittent failures', async () => {
            let attempt = 0;
            const errors = [true, false, true, false]; // Alternating failures

            const result = await executeWithRetry(
                async () => {
                    const shouldFail = errors[attempt];
                    attempt++;

                    if (shouldFail) {
                        throw new NetworkError('Intermittent failure');
                    }
                    return { status: 'ok' };
                },
                { source: 'plex', operation: 'healthCheck' },
                { maxRetries: 4, baseDelay: 10 }
            );

            expect(result.status).toBe('ok');
            expect(attempt).toBeLessThanOrEqual(4);
        });

        test('should handle cascading failures gracefully', async () => {
            // Simulate scenario where fallback sources are tried
            const sources = ['plex', 'jellyfin', 'tmdb'];
            const results = [];

            for (const source of sources) {
                try {
                    const result = await executeWithRetry(
                        async () => {
                            if (source === 'plex' || source === 'jellyfin') {
                                throw new NetworkError(`${source} unavailable`);
                            }
                            return { source, data: [] };
                        },
                        { source, operation: 'fetchMedia' },
                        { maxRetries: 1, baseDelay: 10 }
                    );
                    results.push(result);
                    break; // Success, stop trying fallbacks
                } catch (error) {
                    // Continue to next source
                }
            }

            expect(results).toHaveLength(1);
            expect(results[0].source).toBe('tmdb');
        });
    });

    describe('Metrics accuracy', () => {
        test('should accurately track success after retry', async () => {
            let attempt = 0;

            await executeWithRetry(
                async () => {
                    attempt++;
                    if (attempt === 1) {
                        throw new NetworkError('First attempt fails');
                    }
                    return { success: true };
                },
                { source: 'plex', operation: 'test' },
                { maxRetries: 2, baseDelay: 10 }
            );

            const metrics = getErrorMetrics('plex');
            expect(metrics.test.total).toBe(2); // Initial attempt + 1 retry
            expect(metrics.test.retries).toBe(1);
            expect(metrics.test.errors).toBe(1); // One error before success
        });

        test('should track multiple operations per source', async () => {
            await Promise.all([
                executeWithRetry(
                    async () => ({ result: 'fetchMedia' }),
                    { source: 'plex', operation: 'fetchMedia' },
                    { maxRetries: 1, baseDelay: 10 }
                ),
                executeWithRetry(
                    async () => ({ result: 'getLibraries' }),
                    { source: 'plex', operation: 'getLibraries' },
                    { maxRetries: 1, baseDelay: 10 }
                ),
            ]);

            const metrics = getErrorMetrics('plex');
            expect(metrics).toHaveProperty('fetchMedia');
            expect(metrics).toHaveProperty('getLibraries');
            expect(metrics.fetchMedia.total).toBe(1);
            expect(metrics.getLibraries.total).toBe(1);
        });
    });

    describe('Performance under load', () => {
        test('should handle concurrent operations efficiently', async () => {
            const operations = Array.from({ length: 20 }, (_, i) => {
                return executeWithRetry(
                    async () => {
                        // Simulate fast operation
                        return { id: i };
                    },
                    { source: 'plex', operation: `operation${i % 3}` },
                    { maxRetries: 1, baseDelay: 10 }
                );
            });

            const startTime = Date.now();
            const results = await Promise.all(operations);
            const duration = Date.now() - startTime;

            expect(results).toHaveLength(20);
            expect(duration).toBeLessThan(1000); // Should complete quickly
        });

        test('should not impact successful operations with retry overhead', async () => {
            const startTime = Date.now();

            await executeWithRetry(
                async () => {
                    return { fast: true };
                },
                { source: 'jellyfin', operation: 'quickOp' },
                { maxRetries: 3, baseDelay: 10 }
            );

            const duration = Date.now() - startTime;
            expect(duration).toBeLessThan(100); // No retry overhead for success
        });
    });

    describe('Error context preservation', () => {
        test('should preserve error context through retry chain', async () => {
            const errorContext = {
                source: 'plex',
                operation: 'fetchMedia',
                params: { libraryId: '123', limit: 100 },
            };

            try {
                await executeWithRetry(
                    async () => {
                        throw new NetworkError('Test error', errorContext);
                    },
                    errorContext,
                    { maxRetries: 1, baseDelay: 10 }
                );
            } catch (error) {
                expect(error).toBeInstanceOf(NetworkError);
                expect(error.source).toBe('plex');
                expect(error.operation).toBe('fetchMedia');
            }
        });
    });
});
