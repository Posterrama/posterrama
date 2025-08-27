/**
 * Comprehensive test suite for middleware/index.js
 * Tests all middleware factories and their configurations
 */

const request = require('supertest');
const express = require('express');
const {
    securityMiddleware,
    compressionMiddleware,
    corsMiddleware,
    requestLoggingMiddleware,
    errorHandlingMiddleware,
    healthCheckMiddleware,
} = require('../../middleware/index');

// Mock dependencies
jest.mock('../../logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
}));

const logger = require('../../utils/logger');

describe('Middleware Index - Comprehensive Tests', () => {
    let app;

    beforeEach(() => {
        app = express();
        // Reset all mocks
        jest.clearAllMocks();

        // Reset environment
        delete process.env.NODE_ENV;
    });

    afterEach(() => {
        // Clean up any timers or listeners
        if (app && app.close) {
            app.close();
        }
    });

    describe('Module Exports', () => {
        test('should export all expected middleware functions', () => {
            expect(typeof securityMiddleware).toBe('function');
            expect(typeof compressionMiddleware).toBe('function');
            expect(typeof corsMiddleware).toBe('function');
            expect(typeof requestLoggingMiddleware).toBe('function');
            expect(typeof errorHandlingMiddleware).toBe('function');
            expect(typeof healthCheckMiddleware).toBe('function');
        });
    });

    describe('Security Middleware', () => {
        test('should apply helmet security headers', async () => {
            app.use(securityMiddleware());
            app.get('/test', (req, res) => res.json({ test: true }));

            const response = await request(app).get('/test');

            // Check for helmet security headers
            expect(response.headers).toHaveProperty('x-content-type-options');
            expect(response.headers).toHaveProperty('x-frame-options');
            expect(response.headers).toHaveProperty('x-xss-protection');
        });

        test('should configure CSP with correct directives', async () => {
            app.use(securityMiddleware());
            app.get('/test', (req, res) => res.json({ test: true }));

            const response = await request(app).get('/test');

            expect(response.headers['content-security-policy']).toContain("default-src 'self'");
            expect(response.headers['content-security-policy']).toContain(
                "script-src 'self' 'unsafe-inline'"
            );
            expect(response.headers['content-security-policy']).toContain(
                "img-src 'self' data: https: http:"
            );
        });

        test('should configure HSTS with correct settings', async () => {
            app.use(securityMiddleware());
            app.get('/test', (req, res) => res.json({ test: true }));

            const response = await request(app).get('/test');

            expect(response.headers['strict-transport-security']).toContain('max-age=31536000');
            expect(response.headers['strict-transport-security']).toContain('includeSubDomains');
            expect(response.headers['strict-transport-security']).toContain('preload');
        });
    });

    describe('Compression Middleware', () => {
        test('should compress JSON responses above threshold', async () => {
            app.use(compressionMiddleware());
            app.get('/large-json', (req, res) => {
                const largeData = { data: 'x'.repeat(2000) }; // > 1KB
                res.json(largeData);
            });

            const response = await request(app).get('/large-json').set('Accept-Encoding', 'gzip');

            expect(response.headers['content-encoding']).toBe('gzip');
        });

        test('should not compress when x-no-compression header is present', async () => {
            app.use(compressionMiddleware());
            app.get('/no-compress', (req, res) => {
                const largeData = { data: 'x'.repeat(2000) };
                res.json(largeData);
            });

            const response = await request(app)
                .get('/no-compress')
                .set('Accept-Encoding', 'gzip')
                .set('x-no-compression', '1');

            expect(response.headers['content-encoding']).toBeUndefined();
        });

        test('should not compress image URLs', async () => {
            app.use(compressionMiddleware());
            app.get('/image/test.jpg', (req, res) => {
                res.send('x'.repeat(2000)); // Large content
            });

            const response = await request(app)
                .get('/image/test.jpg')
                .set('Accept-Encoding', 'gzip');

            expect(response.headers['content-encoding']).toBeUndefined();
        });

        test('should not compress .png files', async () => {
            app.use(compressionMiddleware());
            app.get('/test.png', (req, res) => {
                res.send('x'.repeat(2000));
            });

            const response = await request(app).get('/test.png').set('Accept-Encoding', 'gzip');

            expect(response.headers['content-encoding']).toBeUndefined();
        });

        test('should not compress .gif files', async () => {
            app.use(compressionMiddleware());
            app.get('/test.gif', (req, res) => {
                res.send('x'.repeat(2000));
            });

            const response = await request(app).get('/test.gif').set('Accept-Encoding', 'gzip');

            expect(response.headers['content-encoding']).toBeUndefined();
        });

        test('should not compress .webp files', async () => {
            app.use(compressionMiddleware());
            app.get('/test.webp', (req, res) => {
                res.send('x'.repeat(2000));
            });

            const response = await request(app).get('/test.webp').set('Accept-Encoding', 'gzip');

            expect(response.headers['content-encoding']).toBeUndefined();
        });

        test('should not compress small responses below threshold', async () => {
            app.use(compressionMiddleware());
            app.get('/small', (req, res) => {
                res.json({ small: 'data' }); // < 1KB
            });

            const response = await request(app).get('/small').set('Accept-Encoding', 'gzip');

            expect(response.headers['content-encoding']).toBeUndefined();
        });
    });

    describe('CORS Middleware', () => {
        test('should allow requests without origin', async () => {
            app.use(corsMiddleware());
            app.get('/test', (req, res) => res.json({ test: true }));

            const response = await request(app).get('/test');

            // CORS middleware sets * for requests without origin
            expect(response.headers['access-control-allow-credentials']).toBe('true');
            // The origin header behavior depends on the actual CORS implementation
            expect(response.headers).toHaveProperty('access-control-allow-credentials');
        });

        test('should allow requests with null origin', async () => {
            app.use(corsMiddleware());
            app.options('/test', (req, res) => res.sendStatus(200));

            const response = await request(app).options('/test').set('Origin', 'null');

            expect(response.headers['access-control-allow-origin']).toBe('null');
        });

        test('should allow any origin for self-hosted applications', async () => {
            app.use(corsMiddleware());
            app.options('/test', (req, res) => res.sendStatus(200));

            const response = await request(app)
                .options('/test')
                .set('Origin', 'https://example.com');

            expect(response.headers['access-control-allow-origin']).toBe('https://example.com');
        });

        test('should set correct allowed methods', async () => {
            app.use(corsMiddleware());
            app.options('/test', (req, res) => res.sendStatus(200));

            const response = await request(app)
                .options('/test')
                .set('Origin', 'https://example.com')
                .set('Access-Control-Request-Method', 'POST');

            expect(response.headers['access-control-allow-methods']).toContain('GET');
            expect(response.headers['access-control-allow-methods']).toContain('POST');
            expect(response.headers['access-control-allow-methods']).toContain('PUT');
            expect(response.headers['access-control-allow-methods']).toContain('DELETE');
            expect(response.headers['access-control-allow-methods']).toContain('OPTIONS');
        });

        test('should set correct allowed headers', async () => {
            app.use(corsMiddleware());
            app.options('/test', (req, res) => res.sendStatus(200));

            const response = await request(app)
                .options('/test')
                .set('Origin', 'https://example.com')
                .set('Access-Control-Request-Headers', 'Content-Type');

            expect(response.headers['access-control-allow-headers']).toContain('Content-Type');
            expect(response.headers['access-control-allow-headers']).toContain('Authorization');
            expect(response.headers['access-control-allow-headers']).toContain('X-Requested-With');
        });
    });

    describe('Request Logging Middleware', () => {
        test('should log API requests with info level', async () => {
            app.use(requestLoggingMiddleware());
            app.get('/api/test', (req, res) => res.json({ test: true }));

            await request(app).get('/api/test');

            expect(logger.info).toHaveBeenCalledWith(
                'API request completed',
                expect.objectContaining({
                    method: 'GET',
                    url: '/api/test',
                    statusCode: 200,
                    duration: expect.stringMatching(/\d+ms/),
                })
            );
        });

        test('should log errors for 4xx status codes', async () => {
            app.use(requestLoggingMiddleware());
            app.get('/not-found', (req, res) => res.status(404).json({ error: 'Not found' }));

            await request(app).get('/not-found');

            expect(logger.warn).toHaveBeenCalledWith(
                'Request completed with error',
                expect.objectContaining({
                    statusCode: 404,
                })
            );
        });

        test('should log errors for 5xx status codes', async () => {
            app.use(requestLoggingMiddleware());
            app.get('/server-error', (req, res) => res.status(500).json({ error: 'Server error' }));

            await request(app).get('/server-error');

            expect(logger.warn).toHaveBeenCalledWith(
                'Request completed with error',
                expect.objectContaining({
                    statusCode: 500,
                })
            );
        });

        test('should capture response size for JSON responses', async () => {
            app.use(requestLoggingMiddleware());
            app.get('/api/data', (req, res) => res.json({ message: 'test data' }));

            await request(app).get('/api/data');

            expect(logger.info).toHaveBeenCalledWith(
                'API request completed',
                expect.objectContaining({
                    responseSize: expect.any(Number),
                })
            );

            const logCall = logger.info.mock.calls[0][1];
            expect(logCall.responseSize).toBeGreaterThan(0);
        });

        test('should truncate long user agent strings', async () => {
            app.use(requestLoggingMiddleware());
            app.get('/api/test', (req, res) => res.json({ test: true }));

            const longUserAgent = 'x'.repeat(200);

            await request(app).get('/api/test').set('User-Agent', longUserAgent);

            expect(logger.info).toHaveBeenCalledWith(
                'API request completed',
                expect.objectContaining({
                    userAgent: expect.stringMatching(/^x{100}$/),
                })
            );
        });

        test('should handle requests without user agent', async () => {
            app.use(requestLoggingMiddleware());
            app.get('/api/test', (req, res) => res.json({ test: true }));

            await request(app).get('/api/test');

            expect(logger.info).toHaveBeenCalledWith(
                'API request completed',
                expect.objectContaining({
                    userAgent: undefined,
                })
            );
        });

        test('should include IP address in logs', async () => {
            app.use(requestLoggingMiddleware());
            app.get('/api/test', (req, res) => res.json({ test: true }));

            await request(app).get('/api/test');

            expect(logger.info).toHaveBeenCalledWith(
                'API request completed',
                expect.objectContaining({
                    ip: expect.any(String),
                })
            );
        });

        test('should not log non-API requests at info level', async () => {
            app.use(requestLoggingMiddleware());
            app.get('/public/page', (req, res) => res.send('OK'));

            await request(app).get('/public/page');

            expect(logger.info).not.toHaveBeenCalled();
        });

        test('should detect and log slow requests', async () => {
            app.use(requestLoggingMiddleware());
            app.get('/slow', (req, res) => {
                // Simulate slow response
                setTimeout(() => res.json({ slow: true }), 10);
            });

            // Mock Date.now to simulate slow request (>5000ms)
            const originalNow = Date.now;
            let callCount = 0;
            Date.now = jest.fn(() => {
                if (callCount === 0) {
                    callCount++;
                    return originalNow();
                } else {
                    return originalNow() + 6000; // 6 second duration
                }
            });

            await request(app).get('/slow');

            expect(logger.warn).toHaveBeenCalledWith(
                'Slow request detected',
                expect.objectContaining({
                    duration: expect.stringMatching(/^60\d\dms$/), // 6000+ms due to async timing
                })
            );

            // Restore original Date.now
            Date.now = originalNow;
        });
    });

    describe('Error Handling Middleware', () => {
        test('should handle client errors (4xx) with warn level', async () => {
            app.get('/test', (req, res, next) => {
                const error = new Error('Client error');
                error.statusCode = 400;
                next(error);
            });
            app.use(errorHandlingMiddleware());

            const response = await request(app).get('/test');

            expect(response.status).toBe(400);
            expect(response.body).toEqual({
                success: false,
                error: {
                    message: 'Client error',
                    code: 400,
                },
            });

            expect(logger.warn).toHaveBeenCalledWith(
                'Client error occurred',
                expect.objectContaining({
                    error: 'Client error',
                    url: '/test',
                    method: 'GET',
                })
            );
        });

        test('should handle server errors (5xx) with error level', async () => {
            app.get('/test', (req, res, next) => {
                const error = new Error('Server error');
                error.statusCode = 500;
                next(error);
            });
            app.use(errorHandlingMiddleware());

            const response = await request(app).get('/test');

            expect(response.status).toBe(500);
            expect(response.body).toEqual({
                success: false,
                error: {
                    message: 'Internal Server Error',
                    code: 500,
                },
            });

            expect(logger.error).toHaveBeenCalledWith(
                'Server error occurred',
                expect.objectContaining({
                    error: 'Server error',
                })
            );
        });

        test('should default to 500 for errors without statusCode', async () => {
            app.get('/test', (req, res, next) => {
                next(new Error('Unknown error'));
            });
            app.use(errorHandlingMiddleware());

            const response = await request(app).get('/test');

            expect(response.status).toBe(500);
            expect(response.body.error.code).toBe(500);
            expect(response.body.error.message).toBe('Internal Server Error');
        });

        test('should include stack trace in development mode', async () => {
            process.env.NODE_ENV = 'development';

            app.get('/test', (req, res, next) => {
                const error = new Error('Test error');
                error.statusCode = 400;
                next(error);
            });
            app.use(errorHandlingMiddleware());

            const response = await request(app).get('/test');

            expect(response.body.error).toHaveProperty('stack');
            expect(response.body.error.stack).toContain('Test error');
        });

        test('should not include stack trace in production', async () => {
            process.env.NODE_ENV = 'production';

            app.get('/test', (req, res, next) => {
                const error = new Error('Test error');
                error.statusCode = 400;
                next(error);
            });
            app.use(errorHandlingMiddleware());

            const response = await request(app).get('/test');

            expect(response.body.error).not.toHaveProperty('stack');
        });

        test('should handle errors when headers are already sent', done => {
            app.get('/test', (req, res, next) => {
                res.write('Partial response');
                const error = new Error('Late error');
                // Use setTimeout to ensure headers are definitely sent
                setTimeout(() => next(error), 10);
            });
            app.use(errorHandlingMiddleware());

            request(app)
                .get('/test')
                .end((_err, _res) => {
                    // This test mainly ensures no crash occurs and error is logged
                    expect(logger.error).toHaveBeenCalled();
                    done();
                });
        });

        test('should log complete error information', async () => {
            app.get('/test', (req, res, next) => {
                const error = new Error('Test error');
                error.statusCode = 422;
                next(error);
            });
            app.use(errorHandlingMiddleware());

            await request(app).get('/test').set('User-Agent', 'Test Agent');

            expect(logger.warn).toHaveBeenCalledWith(
                'Client error occurred',
                expect.objectContaining({
                    error: 'Test error',
                    stack: expect.stringContaining('Test error'),
                    url: '/test',
                    method: 'GET',
                    ip: expect.any(String),
                    userAgent: 'Test Agent',
                })
            );
        });
    });

    describe('Health Check Middleware', () => {
        test('should return health status with system information', async () => {
            app.get('/health', healthCheckMiddleware());

            const response = await request(app).get('/health');

            expect(response.status).toBe(200);
            expect(response.body).toEqual({
                status: 'healthy',
                timestamp: expect.any(String),
                uptime: {
                    seconds: expect.any(Number),
                    human: expect.stringMatching(/\d+h \d+m \d+s/),
                },
                memory: {
                    rss: expect.stringMatching(/\d+MB/),
                    heapTotal: expect.stringMatching(/\d+MB/),
                    heapUsed: expect.stringMatching(/\d+MB/),
                    external: expect.stringMatching(/\d+MB/),
                },
                environment: {
                    nodeVersion: process.version,
                    platform: process.platform,
                    arch: process.arch,
                },
            });
        });

        test('should return valid ISO timestamp', async () => {
            app.get('/health', healthCheckMiddleware());

            const response = await request(app).get('/health');

            expect(() => new Date(response.body.timestamp).toISOString()).not.toThrow();
            expect(new Date(response.body.timestamp).toISOString()).toBe(response.body.timestamp);
        });

        test('should calculate uptime correctly', async () => {
            app.get('/health', healthCheckMiddleware());

            const response = await request(app).get('/health');

            expect(response.body.uptime.seconds).toBeGreaterThanOrEqual(0);
            expect(response.body.uptime.human).toMatch(/^\d+h \d+m \d+s$/);
        });

        test('should provide memory usage in MB format', async () => {
            app.get('/health', healthCheckMiddleware());

            const response = await request(app).get('/health');

            const memory = response.body.memory;
            Object.values(memory).forEach(value => {
                expect(value).toMatch(/^\d+MB$/);
                expect(parseInt(value)).toBeGreaterThan(0);
            });
        });

        test('should include environment information', async () => {
            app.get('/health', healthCheckMiddleware());

            const response = await request(app).get('/health');

            const env = response.body.environment;
            expect(env.nodeVersion).toBe(process.version);
            expect(env.platform).toBe(process.platform);
            expect(env.arch).toBe(process.arch);
        });
    });

    describe('Integration Scenarios', () => {
        test('should work with multiple middleware combined', async () => {
            app.use(securityMiddleware());
            app.use(compressionMiddleware());
            app.use(corsMiddleware());
            app.use(requestLoggingMiddleware());

            app.get('/api/integrated', (req, res) => {
                res.json({ message: 'All middleware working' });
            });

            app.use(errorHandlingMiddleware());

            const response = await request(app)
                .get('/api/integrated')
                .set('Origin', 'https://example.com');

            expect(response.status).toBe(200);
            expect(response.headers['access-control-allow-origin']).toBe('https://example.com');
            expect(response.headers).toHaveProperty('x-content-type-options');
            expect(logger.info).toHaveBeenCalledWith(
                'API request completed',
                expect.objectContaining({
                    url: '/api/integrated',
                })
            );
        });

        test('should handle errors properly in integrated setup', async () => {
            app.use(requestLoggingMiddleware());
            app.get('/api/error', (req, res, next) => {
                next(new Error('Integration test error'));
            });
            app.use(errorHandlingMiddleware());

            const response = await request(app).get('/api/error');

            expect(response.status).toBe(500);
            expect(logger.warn).toHaveBeenCalledWith(
                'Request completed with error',
                expect.objectContaining({ statusCode: 500 })
            );
            expect(logger.error).toHaveBeenCalledWith(
                'Server error occurred',
                expect.objectContaining({ error: 'Integration test error' })
            );
        });
    });
});
