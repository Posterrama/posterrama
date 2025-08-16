// Mock express-rate-limit first, before any imports
const mockRateLimitMiddleware = jest.fn((options) => {
    const middleware = jest.fn((req, res, next) => next());
    middleware.options = options;
    return middleware;
});

jest.mock('express-rate-limit', () => mockRateLimitMiddleware);

const { createRateLimiter } = require('../../middleware/rateLimiter');

describe('Rate Limiter Comprehensive', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.RATE_LIMIT_TEST;
    });

    afterEach(() => {
        delete process.env.RATE_LIMIT_TEST;
    });

    describe('Factory Function', () => {
        test('should create rate limiter with correct default configuration', () => {
            const windowMs = 60000; // 1 minute
            const max = 100;
            const message = 'Too many requests';

            const limiter = createRateLimiter(windowMs, max, message);

            // The function should call mockRateLimitMiddleware
            expect(mockRateLimitMiddleware).toHaveBeenCalledWith({
                windowMs: windowMs,
                max: max,
                standardHeaders: true,
                legacyHeaders: false,
                message: expect.any(Function)
            });
        });

        test('should pass through direct options (trust proxy from config)', () => {
            const windowMs = 30000;
            const max = 50;
            const message = 'Rate limit exceeded';
            
            // Set NODE_ENV to something else to test the trust proxy logic
            process.env.NODE_ENV = 'production';

            const limiter = createRateLimiter(windowMs, max, message);

            const expectedConfig = {
                windowMs: 30000,
                max: 50,
                standardHeaders: true,
                legacyHeaders: false,
                message: expect.any(Function)
            };

            expect(mockRateLimitMiddleware).toHaveBeenCalledWith(expectedConfig);
        });
    });

    describe('Test Environment Behavior', () => {
        test('should use strict rate limiting when RATE_LIMIT_TEST=strict', () => {
            process.env.RATE_LIMIT_TEST = 'strict';
            
            const windowMs = 60000;
            const max = 100; // Should become 2 in strict mode (100 / 50 = 2)
            const message = 'Strict rate limit';

            const limiter = createRateLimiter(windowMs, max, message);

            expect(mockRateLimitMiddleware).toHaveBeenCalledWith({
                windowMs: windowMs,
                max: 2, // Math.max(1, Math.floor(100 / 50))
                standardHeaders: true,
                legacyHeaders: false,
                message: expect.any(Function)
            });
        });

        test('should use minimum of 1 for very small max values in strict mode', () => {
            process.env.RATE_LIMIT_TEST = 'strict';
            
            const windowMs = 5000;
            const max = 10; // Should become 1 in strict mode (Math.max(1, Math.floor(10 / 50)))
            const message = 'Very strict limit';

            const limiter = createRateLimiter(windowMs, max, message);

            expect(mockRateLimitMiddleware).toHaveBeenCalledWith({
                windowMs: windowMs,
                max: 1, // Math.max(1, Math.floor(10 / 50)) = Math.max(1, 0) = 1
                standardHeaders: true,
                legacyHeaders: false,
                message: expect.any(Function)
            });
        });

        test('should use normal limits when RATE_LIMIT_TEST is not strict', () => {
            process.env.RATE_LIMIT_TEST = 'normal';
            
            const windowMs = 30000;
            const max = 200;
            const message = 'Normal rate limit';

            const limiter = createRateLimiter(windowMs, max, message);

            expect(mockRateLimitMiddleware).toHaveBeenCalledWith({
                windowMs: windowMs,
                max: 200, // Original value, not modified
                standardHeaders: true,
                legacyHeaders: false,
                message: expect.any(Function)
            });
        });

        test('should use normal limits when RATE_LIMIT_TEST is undefined', () => {
            // Don't set RATE_LIMIT_TEST environment variable
            
            const windowMs = 45000;
            const max = 150;
            const message = 'Default rate limit';

            const limiter = createRateLimiter(windowMs, max, message);

            expect(mockRateLimitMiddleware).toHaveBeenCalledWith({
                windowMs: windowMs,
                max: 150, // Original value, not modified
                standardHeaders: true,
                legacyHeaders: false,
                message: expect.any(Function)
            });
        });
    });

    describe('Message Function', () => {
        test('should create proper message function with correct structure', () => {
            const windowMs = 60000;
            const max = 100;
            const messageText = 'Custom rate limit message';

            createRateLimiter(windowMs, max, messageText);

            const callArgs = mockRateLimitMiddleware.mock.calls[0][0];
            const messageFunction = callArgs.message;

            expect(typeof messageFunction).toBe('function');

            // Test the message function
            const mockReq = {
                path: '/api/test',
                method: 'GET',
                id: 'req-123'
            };

            const result = messageFunction(mockReq);

            expect(result).toEqual({
                error: messageText,
                timestamp: expect.any(String),
                path: '/api/test',
                method: 'GET',
                requestId: 'req-123',
                retryAfter: 60 // Math.ceil(60000 / 1000)
            });

            // Verify timestamp is valid ISO string
            expect(() => new Date(result.timestamp).toISOString()).not.toThrow();
            expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
        });

        test('should handle request without id', () => {
            const windowMs = 30000;
            const max = 50;
            const messageText = 'No ID test';

            createRateLimiter(windowMs, max, messageText);

            const callArgs = mockRateLimitMiddleware.mock.calls[0][0];
            const messageFunction = callArgs.message;

            const mockReq = {
                path: '/api/no-id',
                method: 'POST'
                // No id property
            };

            const result = messageFunction(mockReq);

            expect(result.requestId).toBe('unknown');
            expect(result.retryAfter).toBe(30); // Math.ceil(30000 / 1000)
        });

        test('should calculate correct retryAfter for different windowMs values', () => {
            const testCases = [
                { windowMs: 15000, expected: 15 },
                { windowMs: 60000, expected: 60 },
                { windowMs: 90000, expected: 90 },
                { windowMs: 1500, expected: 2 }, // Math.ceil(1500 / 1000) = 2
                { windowMs: 500, expected: 1 }   // Math.ceil(500 / 1000) = 1
            ];

            testCases.forEach(({ windowMs, expected }) => {
                jest.clearAllMocks();
                
                createRateLimiter(windowMs, 100, 'Test message');

                const callArgs = mockRateLimitMiddleware.mock.calls[0][0];
                const messageFunction = callArgs.message;

                const result = messageFunction({ path: '/test', method: 'GET' });
                expect(result.retryAfter).toBe(expected);
            });
        });
    });

    describe('Module Exports', () => {
        test('should export createRateLimiter function', () => {
            const rateLimiterModule = require('../../middleware/rateLimiter');
            
            expect(typeof rateLimiterModule.createRateLimiter).toBe('function');
            expect(rateLimiterModule.createRateLimiter).toBe(createRateLimiter);
        });
    });

    describe('Integration Scenarios', () => {
        test('should work with various realistic configurations', () => {
            const configs = [
                { windowMs: 60000, max: 100, message: 'General API limit' },
                { windowMs: 15000, max: 5, message: 'Login attempt limit' },
                { windowMs: 900000, max: 1000, message: 'Heavy operation limit' }
            ];

            configs.forEach((config, index) => {
                jest.clearAllMocks();
                
                const limiter = createRateLimiter(config.windowMs, config.max, config.message);
                
                expect(mockRateLimitMiddleware).toHaveBeenCalledTimes(1);
                
                const callArgs = mockRateLimitMiddleware.mock.calls[0][0];
                expect(callArgs.windowMs).toBe(config.windowMs);
                expect(callArgs.max).toBe(config.max);
                expect(callArgs.standardHeaders).toBe(true);
                expect(callArgs.legacyHeaders).toBe(false);
            });
        });

        test('should handle edge case with zero max in strict mode', () => {
            process.env.RATE_LIMIT_TEST = 'strict';
            
            const limiter = createRateLimiter(60000, 1, 'Edge case'); // 1 / 50 = 0, but Math.max(1, 0) = 1
            
            expect(mockRateLimitMiddleware).toHaveBeenCalledWith({
                windowMs: 60000,
                max: 1,
                standardHeaders: true,
                legacyHeaders: false,
                message: expect.any(Function)
            });
        });
    });
});
