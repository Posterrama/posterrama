/**
 * Tests for source error metrics endpoints (Issue #97 Phase 6)
 * Verifies /api/metrics/source-errors endpoints work correctly
 */

const request = require('supertest');
const express = require('express');
const createSourceErrorMetricsRouter = require('../../routes/source-error-metrics');
const { executeWithRetry, resetErrorMetrics } = require('../../utils/source-error-handler');
const { NetworkError } = require('../../utils/errors');

describe('Source Error Metrics Routes (#97)', () => {
    let app;

    beforeEach(() => {
        // Reset all metrics before each test
        ['plex', 'jellyfin', 'tmdb', 'romm', 'local'].forEach(source => {
            resetErrorMetrics(source);
        });

        // Create fresh Express app for each test
        app = express();
        app.use(express.json());
        app.use('/', createSourceErrorMetricsRouter());
    });

    describe('GET /api/metrics/source-errors', () => {
        test('should return empty metrics when no errors have occurred', async () => {
            const response = await request(app).get('/api/metrics/source-errors').expect(200);

            expect(response.body).toEqual({});
        });

        test('should return metrics for all sources with errors', async () => {
            // Generate some errors for different sources
            await Promise.allSettled([
                executeWithRetry(
                    async () => {
                        throw new NetworkError('Plex connection failed');
                    },
                    { source: 'plex', operation: 'fetchMedia' }
                ),
                executeWithRetry(
                    async () => {
                        throw new NetworkError('Jellyfin timeout');
                    },
                    { source: 'jellyfin', operation: 'fetchMedia' }
                ),
            ]);

            const response = await request(app).get('/api/metrics/source-errors').expect(200);

            // Verify structure: {source: {operation: {total, errors, retries}}}
            expect(response.body).toHaveProperty('plex');
            expect(response.body).toHaveProperty('jellyfin');
            expect(response.body.plex).toHaveProperty('fetchMedia');
            expect(response.body.jellyfin).toHaveProperty('fetchMedia');

            expect(response.body.plex.fetchMedia).toMatchObject({
                total: expect.any(Number),
                errors: expect.any(Number),
                retries: expect.any(Number),
            });
        });

        test('should track multiple operations per source', async () => {
            // Generate different operations
            await Promise.allSettled([
                executeWithRetry(
                    async () => {
                        throw new NetworkError('Network error 1');
                    },
                    { source: 'plex', operation: 'fetchMedia' }
                ),
                executeWithRetry(
                    async () => {
                        throw new NetworkError('Network error 2');
                    },
                    { source: 'plex', operation: 'fetchLibraries' }
                ),
            ]);

            const response = await request(app).get('/api/metrics/source-errors').expect(200);

            expect(response.body.plex).toHaveProperty('fetchMedia');
            expect(response.body.plex).toHaveProperty('fetchLibraries');
            expect(response.body.plex.fetchMedia.errors).toBeGreaterThan(0);
            expect(response.body.plex.fetchLibraries.errors).toBeGreaterThan(0);
        });
    });

    describe('GET /api/metrics/source-errors/:source', () => {
        test('should return 404 for source with no metrics', async () => {
            const response = await request(app).get('/api/metrics/source-errors/plex').expect(404);

            expect(response.body).toMatchObject({
                error: 'Not Found',
                message: expect.stringContaining('plex'),
            });
        });

        test('should return metrics for specific source', async () => {
            // Generate error for plex only
            await executeWithRetry(
                async () => {
                    throw new NetworkError('Plex error');
                },
                { source: 'plex', operation: 'fetchMedia' }
            ).catch(() => {});

            const response = await request(app).get('/api/metrics/source-errors/plex').expect(200);

            // Should return per-operation metrics for plex
            expect(response.body).toHaveProperty('fetchMedia');
            expect(response.body.fetchMedia).toMatchObject({
                total: expect.any(Number),
                errors: expect.any(Number),
                retries: expect.any(Number),
            });
            expect(response.body.fetchMedia.total).toBeGreaterThan(0);
        });

        test('should return 404 for unknown source', async () => {
            const response = await request(app)
                .get('/api/metrics/source-errors/invalid-source')
                .expect(404);

            expect(response.body.error).toBe('Not Found');
        });

        test('should return per-operation metrics', async () => {
            await executeWithRetry(
                async () => {
                    throw new NetworkError('Test error');
                },
                { source: 'jellyfin', operation: 'authenticate' }
            ).catch(() => {});

            const response = await request(app)
                .get('/api/metrics/source-errors/jellyfin')
                .expect(200);

            expect(response.body).toHaveProperty('authenticate');
            expect(response.body.authenticate).toMatchObject({
                total: expect.any(Number),
                errors: expect.any(Number),
                retries: expect.any(Number),
            });
        });
    });

    describe('DELETE /api/metrics/source-errors/:source', () => {
        test('should reset metrics for specific source', async () => {
            // Generate some errors
            await executeWithRetry(
                async () => {
                    throw new NetworkError('Plex error');
                },
                { source: 'plex', operation: 'fetchMedia' }
            ).catch(() => {});

            // Verify metrics exist
            let response = await request(app).get('/api/metrics/source-errors/plex').expect(200);
            expect(response.body.fetchMedia.total).toBeGreaterThan(0);

            // Reset metrics
            response = await request(app).delete('/api/metrics/source-errors/plex').expect(200);

            expect(response.body).toMatchObject({
                success: true,
                message: expect.stringContaining('reset'),
                source: 'plex',
            });

            // Verify metrics are gone
            response = await request(app).get('/api/metrics/source-errors/plex').expect(404);
        });

        test('should return 400 for invalid source', async () => {
            const response = await request(app)
                .delete('/api/metrics/source-errors/invalid-source')
                .expect(400);

            expect(response.body).toMatchObject({
                error: 'Bad Request',
                message: expect.stringContaining('Invalid source'),
            });
        });

        test('should only reset specified source', async () => {
            // Generate errors for multiple sources
            await Promise.allSettled([
                executeWithRetry(
                    async () => {
                        throw new NetworkError('Plex error');
                    },
                    { source: 'plex', operation: 'fetchMedia' }
                ),
                executeWithRetry(
                    async () => {
                        throw new NetworkError('Jellyfin error');
                    },
                    { source: 'jellyfin', operation: 'fetchMedia' }
                ),
            ]);

            // Reset only plex
            await request(app).delete('/api/metrics/source-errors/plex').expect(200);

            // Verify plex is reset
            await request(app).get('/api/metrics/source-errors/plex').expect(404);

            // Verify jellyfin still has metrics
            const response = await request(app)
                .get('/api/metrics/source-errors/jellyfin')
                .expect(200);
            expect(response.body.fetchMedia.total).toBeGreaterThan(0);
        });

        test('should accept all valid source identifiers', async () => {
            const validSources = ['plex', 'jellyfin', 'tmdb', 'romm', 'local'];

            for (const source of validSources) {
                const response = await request(app)
                    .delete(`/api/metrics/source-errors/${source}`)
                    .expect(200);

                expect(response.body.source).toBe(source);
            }
        });
    });

    describe('Error tracking integration', () => {
        test('should track successful retries', async () => {
            let attempt = 0;

            // First call fails twice then succeeds
            await executeWithRetry(
                async () => {
                    attempt++;
                    if (attempt < 3) {
                        throw new NetworkError('Temporary failure');
                    }
                    return 'success';
                },
                { source: 'plex', operation: 'fetchMedia' },
                { maxRetries: 3 }
            );

            const response = await request(app).get('/api/metrics/source-errors/plex').expect(200);

            expect(response.body.fetchMedia.total).toBeGreaterThan(0);
            expect(response.body.fetchMedia.retries).toBeGreaterThan(0);
            // Errors count includes retry attempts
            expect(response.body.fetchMedia.errors).toBeGreaterThan(0);
        });

        test('should track complete failures', async () => {
            await executeWithRetry(
                async () => {
                    throw new NetworkError('Permanent failure');
                },
                { source: 'tmdb', operation: 'fetchGenres' },
                { maxRetries: 2 }
            ).catch(() => {});

            const response = await request(app).get('/api/metrics/source-errors/tmdb').expect(200);

            expect(response.body.fetchGenres.errors).toBeGreaterThan(0);
        });
    });
});
