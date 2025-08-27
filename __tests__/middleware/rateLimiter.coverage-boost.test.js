/**
 * @fileoverview Quick coverage boost for rateLimiter.js
 * Target: Line 10 (message function path) to hit 100% coverage
 */

const express = require('express');
const request = require('supertest');

// Mock express-rate-limit to control its behavior
const mockRateLimit = jest.fn();
jest.mock('express-rate-limit', () => mockRateLimit);

const { createRateLimiter } = require('../../middleware/rateLimiter');

describe('Rate Limiter Coverage Boost', () => {
    let app;
    let mockLimiter;

    beforeEach(() => {
        jest.clearAllMocks();

        // Create a mock limiter function
        mockLimiter = jest.fn((req, res, next) => next());

        // Mock express-rate-limit to return our mock and capture the config
        mockRateLimit.mockReturnValue(mockLimiter);

        app = express();
        app.use(express.json());
    });

    test('should create rate limiter with message function that includes request details', () => {
        const windowMs = 60000;
        const max = 100;
        const messageText = 'Too many requests';

        // Create the rate limiter
        const limiter = createRateLimiter(windowMs, max, messageText);

        // Verify express-rate-limit was called
        expect(mockRateLimit).toHaveBeenCalledTimes(1);

        // Get the configuration passed to express-rate-limit
        const config = mockRateLimit.mock.calls[0][0];

        // Test the message function (line 10) with a mock request
        const mockReq = {
            path: '/api/test',
            method: 'POST',
            id: 'test-request-123',
        };

        const result = config.message(mockReq);

        // Verify the message function output
        expect(result).toEqual({
            error: messageText,
            timestamp: expect.any(String),
            path: '/api/test',
            method: 'POST',
            requestId: 'test-request-123',
            retryAfter: 60,
        });

        // Verify timestamp is valid ISO string
        expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
    });

    test('should handle request without id in message function', () => {
        const windowMs = 30000;
        const max = 50;
        const messageText = 'Rate limit exceeded';

        createRateLimiter(windowMs, max, messageText);

        const config = mockRateLimit.mock.calls[0][0];

        // Test message function with request missing id
        const mockReq = {
            path: '/api/another',
            method: 'GET',
            // No id field
        };

        const result = config.message(mockReq);

        expect(result).toEqual({
            error: messageText,
            timestamp: expect.any(String),
            path: '/api/another',
            method: 'GET',
            requestId: 'unknown',
            retryAfter: 30,
        });
    });

    test('should apply strict rate limiting in test environment', () => {
        // Set test environment
        process.env.RATE_LIMIT_TEST = 'strict';

        const windowMs = 60000;
        const max = 100;
        const messageText = 'Test rate limit';

        createRateLimiter(windowMs, max, messageText);

        const config = mockRateLimit.mock.calls[0][0];

        // In strict mode, max should be reduced to max(1, floor(100/50)) = 2
        expect(config.max).toBe(2);

        // Clean up
        delete process.env.RATE_LIMIT_TEST;
    });

    test('should use normal rate limiting when not in strict test mode', () => {
        // Ensure no test environment
        delete process.env.RATE_LIMIT_TEST;

        const windowMs = 60000;
        const max = 100;
        const messageText = 'Normal rate limit';

        createRateLimiter(windowMs, max, messageText);

        const config = mockRateLimit.mock.calls[0][0];

        // Should use original max value
        expect(config.max).toBe(100);
    });

    test('should configure rate limiter with all required options', () => {
        const windowMs = 45000;
        const max = 75;
        const messageText = 'Custom message';

        createRateLimiter(windowMs, max, messageText);

        const config = mockRateLimit.mock.calls[0][0];

        expect(config.windowMs).toBe(45000);
        expect(config.standardHeaders).toBe(true);
        expect(config.legacyHeaders).toBe(false);
        expect(typeof config.message).toBe('function');
    });
});
