const {
    validationRules,
    rateLimitRules,
    handleValidationErrors,
    createValidationMiddleware,
    sanitizePath,
    sanitizeHtml,
} = require('../../middleware/validation');

const logger = require('../../utils/logger');

// Mock logger
jest.mock('../../utils/logger');

// Mock express-validator
jest.mock('express-validator', () => ({
    validationResult: jest.fn(),
    body: jest.fn(() => ({
        notEmpty: jest.fn().mockReturnThis(),
        isLength: jest.fn().mockReturnThis(),
        matches: jest.fn().mockReturnThis(),
        withMessage: jest.fn().mockReturnThis(),
        optional: jest.fn().mockReturnThis(),
        isIn: jest.fn().mockReturnThis(),
        isInt: jest.fn().mockReturnThis(),
        isAlphanumeric: jest.fn().mockReturnThis(),
        isBoolean: jest.fn().mockReturnThis(),
        isURL: jest.fn().mockReturnThis(),
        trim: jest.fn().mockReturnThis(),
        escape: jest.fn().mockReturnThis(),
        isArray: jest.fn().mockReturnThis(),
    })),
    query: jest.fn(() => ({
        optional: jest.fn().mockReturnThis(),
        isIn: jest.fn().mockReturnThis(),
        withMessage: jest.fn().mockReturnThis(),
        isInt: jest.fn().mockReturnThis(),
        isAlphanumeric: jest.fn().mockReturnThis(),
        isLength: jest.fn().mockReturnThis(),
        isBoolean: jest.fn().mockReturnThis(),
        notEmpty: jest.fn().mockReturnThis(),
        isURL: jest.fn().mockReturnThis(),
        trim: jest.fn().mockReturnThis(),
        escape: jest.fn().mockReturnThis(),
    })),
    param: jest.fn(() => ({
        notEmpty: jest.fn().mockReturnThis(),
        matches: jest.fn().mockReturnThis(),
        isLength: jest.fn().mockReturnThis(),
        withMessage: jest.fn().mockReturnThis(),
    })),
}));

const { validationResult } = require('express-validator');

describe('Validation Middleware - Comprehensive Tests', () => {
    let req, res, next;

    beforeEach(() => {
        jest.clearAllMocks();

        // Mock request object
        req = {
            url: '/api/test',
            method: 'GET',
            ip: '127.0.0.1',
            query: {},
            body: {},
            params: {},
        };

        // Mock response object
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
        };

        // Mock next function
        next = jest.fn();
    });

    describe('handleValidationErrors', () => {
        test('should call next when no validation errors', () => {
            const mockErrors = { isEmpty: jest.fn().mockReturnValue(true) };
            validationResult.mockReturnValue(mockErrors);

            handleValidationErrors(req, res, next);

            expect(next).toHaveBeenCalledTimes(1);
            expect(res.status).not.toHaveBeenCalled();
            expect(res.json).not.toHaveBeenCalled();
        });

        test('should return 400 when validation errors exist', () => {
            const errors = [
                { path: 'username', param: 'username', msg: 'Username is required', value: '' },
                {
                    path: 'email',
                    param: 'email',
                    msg: 'Invalid email format',
                    value: 'invalid-email',
                },
            ];

            const mockErrors = {
                isEmpty: jest.fn().mockReturnValue(false),
                array: jest.fn().mockReturnValue(errors),
            };
            validationResult.mockReturnValue(mockErrors);

            handleValidationErrors(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                success: false,
                error: {
                    message: 'Validation failed',
                    code: 400,
                    details: [
                        { field: 'username', message: 'Username is required', value: '' },
                        { field: 'email', message: 'Invalid email format', value: 'invalid-email' },
                    ],
                },
            });
            expect(next).not.toHaveBeenCalled();
        });

        test('should handle errors without path field', () => {
            const errors = [{ param: 'password', msg: 'Password too short', value: '123' }];

            const mockErrors = {
                isEmpty: jest.fn().mockReturnValue(false),
                array: jest.fn().mockReturnValue(errors),
            };
            validationResult.mockReturnValue(mockErrors);

            handleValidationErrors(req, res, next);

            expect(res.json).toHaveBeenCalledWith({
                success: false,
                error: {
                    message: 'Validation failed',
                    code: 400,
                    details: [{ field: 'password', message: 'Password too short', value: '123' }],
                },
            });
        });

        test('should log validation failures', () => {
            const errors = [{ path: 'username', msg: 'Invalid username', value: 'test@user' }];

            const mockErrors = {
                isEmpty: jest.fn().mockReturnValue(false),
                array: jest.fn().mockReturnValue(errors),
            };
            validationResult.mockReturnValue(mockErrors);

            handleValidationErrors(req, res, next);

            expect(logger.warn).toHaveBeenCalledWith('Validation failed', {
                url: '/api/test',
                method: 'GET',
                errors: [{ field: 'username', message: 'Invalid username', value: 'test@user' }],
                ip: '127.0.0.1',
            });
        });
    });

    describe('validationRules', () => {
        test('should have media request validation rules', () => {
            expect(validationRules.mediaRequest).toBeDefined();
            expect(Array.isArray(validationRules.mediaRequest)).toBe(true);
            expect(validationRules.mediaRequest.length).toBeGreaterThan(0);
        });

        test('should have admin auth validation rules', () => {
            expect(validationRules.adminAuth).toBeDefined();
            expect(Array.isArray(validationRules.adminAuth)).toBe(true);
            expect(validationRules.adminAuth.length).toBeGreaterThan(0);
        });

        test('should have config update validation rules', () => {
            expect(validationRules.configUpdate).toBeDefined();
            expect(Array.isArray(validationRules.configUpdate)).toBe(true);
            expect(validationRules.configUpdate.length).toBeGreaterThan(0);
        });

        test('should have image proxy validation rules', () => {
            expect(validationRules.imageProxy).toBeDefined();
            expect(Array.isArray(validationRules.imageProxy)).toBe(true);
            expect(validationRules.imageProxy.length).toBeGreaterThan(0);
        });

        test('should have cache management validation rules', () => {
            expect(validationRules.cacheManagement).toBeDefined();
            expect(Array.isArray(validationRules.cacheManagement)).toBe(true);
            expect(validationRules.cacheManagement.length).toBeGreaterThan(0);
        });

        test('should have search validation rules', () => {
            expect(validationRules.search).toBeDefined();
            expect(Array.isArray(validationRules.search)).toBe(true);
            expect(validationRules.search.length).toBeGreaterThan(0);
        });

        test('should have ID validation rules', () => {
            expect(validationRules.id).toBeDefined();
            expect(Array.isArray(validationRules.id)).toBe(true);
            expect(validationRules.id.length).toBeGreaterThan(0);
        });

        test('should have admin request validation rules', () => {
            expect(validationRules.adminRequest).toBeDefined();
            expect(Array.isArray(validationRules.adminRequest)).toBe(true);
        });
    });

    describe('rateLimitRules', () => {
        test('should have auth rate limit configuration', () => {
            expect(rateLimitRules.auth).toBeDefined();
            expect(rateLimitRules.auth.windowMs).toBe(15 * 60 * 1000);
            expect(rateLimitRules.auth.max).toBe(5);
            expect(rateLimitRules.auth.message.error.code).toBe(429);
            expect(rateLimitRules.auth.standardHeaders).toBe(true);
            expect(rateLimitRules.auth.legacyHeaders).toBe(false);
            expect(rateLimitRules.auth.skipSuccessfulRequests).toBe(true);
        });

        test('should have API rate limit configuration', () => {
            expect(rateLimitRules.api).toBeDefined();
            expect(rateLimitRules.api.windowMs).toBe(1 * 60 * 1000);
            expect(rateLimitRules.api.max).toBe(60);
            expect(rateLimitRules.api.message.error.code).toBe(429);
            expect(rateLimitRules.api.standardHeaders).toBe(true);
            expect(rateLimitRules.api.legacyHeaders).toBe(false);
        });

        test('should have media rate limit configuration', () => {
            expect(rateLimitRules.media).toBeDefined();
            expect(rateLimitRules.media.windowMs).toBe(1 * 60 * 1000);
            expect(rateLimitRules.media.max).toBe(100);
            expect(rateLimitRules.media.message.error.code).toBe(429);
            expect(rateLimitRules.media.standardHeaders).toBe(true);
            expect(rateLimitRules.media.legacyHeaders).toBe(false);
        });

        test('should have admin rate limit configuration', () => {
            expect(rateLimitRules.admin).toBeDefined();
            expect(rateLimitRules.admin.windowMs).toBe(1 * 60 * 1000);
            expect(rateLimitRules.admin.max).toBe(10);
            expect(rateLimitRules.admin.message.error.code).toBe(429);
            expect(rateLimitRules.admin.standardHeaders).toBe(true);
            expect(rateLimitRules.admin.legacyHeaders).toBe(false);
        });

        test('should have different limits for different endpoint types', () => {
            expect(rateLimitRules.auth.max).toBeLessThan(rateLimitRules.admin.max);
            expect(rateLimitRules.admin.max).toBeLessThan(rateLimitRules.api.max);
            expect(rateLimitRules.api.max).toBeLessThan(rateLimitRules.media.max);
        });

        test('should have consistent message structure across all rate limits', () => {
            Object.values(rateLimitRules).forEach(config => {
                expect(config.message.success).toBe(false);
                expect(config.message.error.code).toBe(429);
                expect(typeof config.message.error.message).toBe('string');
            });
        });
    });

    describe('sanitizePath', () => {
        test('should remove path traversal attempts', () => {
            const maliciousPath = '../../../etc/passwd';
            const sanitized = sanitizePath(maliciousPath);
            expect(sanitized).toBe('/etc/passwd');
            expect(sanitized).not.toContain('..');
        });

        test('should remove dangerous characters', () => {
            const dangerousPath = 'file<>:|"?*.txt';
            const sanitized = sanitizePath(dangerousPath);
            expect(sanitized).toBe('file.txt');
            expect(sanitized).not.toMatch(/[<>:"|?*]/);
        });

        test('should normalize multiple slashes', () => {
            const path = 'folder///subfolder////file.txt';
            const sanitized = sanitizePath(path);
            expect(sanitized).toBe('folder/subfolder/file.txt');
        });

        test('should trim whitespace', () => {
            const path = '  /folder/file.txt  ';
            const sanitized = sanitizePath(path);
            expect(sanitized).toBe('/folder/file.txt');
        });

        test('should handle non-string input', () => {
            expect(sanitizePath(null)).toBe('');
            expect(sanitizePath(undefined)).toBe('');
            expect(sanitizePath(123)).toBe('');
            expect(sanitizePath({})).toBe('');
        });

        test('should handle empty string', () => {
            expect(sanitizePath('')).toBe('');
        });

        test('should handle normal paths correctly', () => {
            const normalPath = '/folder/subfolder/file.txt';
            const sanitized = sanitizePath(normalPath);
            expect(sanitized).toBe(normalPath);
        });
    });

    describe('sanitizeHtml', () => {
        test('should remove angle brackets', () => {
            const htmlContent = '<script>alert("xss")</script>Hello World<div>test</div>';
            const sanitized = sanitizeHtml(htmlContent);
            expect(sanitized).toBe('scriptalert("xss")/scriptHello Worlddivtest/div');
            expect(sanitized).not.toMatch(/[<>]/);
        });

        test('should trim whitespace', () => {
            const content = '  Hello World  ';
            const sanitized = sanitizeHtml(content);
            expect(sanitized).toBe('Hello World');
        });

        test('should handle non-string input', () => {
            expect(sanitizeHtml(null)).toBe('');
            expect(sanitizeHtml(undefined)).toBe('');
            expect(sanitizeHtml(123)).toBe('');
            expect(sanitizeHtml({})).toBe('');
        });

        test('should handle empty string', () => {
            expect(sanitizeHtml('')).toBe('');
        });

        test('should handle normal text without HTML', () => {
            const normalText = 'Hello World 123';
            const sanitized = sanitizeHtml(normalText);
            expect(sanitized).toBe(normalText);
        });

        test('should handle mixed content', () => {
            const mixedContent = 'Normal text <span>with</span> some <b>HTML</b> tags';
            const sanitized = sanitizeHtml(mixedContent);
            expect(sanitized).toBe('Normal text spanwith/span some bHTML/b tags');
        });
    });

    describe('createValidationMiddleware', () => {
        test('should return an array with rules and error handler', () => {
            const testRules = ['rule1', 'rule2'];
            const middleware = createValidationMiddleware(testRules);

            expect(Array.isArray(middleware)).toBe(true);
            expect(middleware.length).toBe(3); // 2 rules + error handler
            expect(middleware[0]).toBe('rule1');
            expect(middleware[1]).toBe('rule2');
            expect(middleware[2]).toBe(handleValidationErrors);
        });

        test('should work with empty rules array', () => {
            const middleware = createValidationMiddleware([]);
            expect(Array.isArray(middleware)).toBe(true);
            expect(middleware.length).toBe(1); // just error handler
            expect(middleware[0]).toBe(handleValidationErrors);
        });

        test('should work with validation rules from the module', () => {
            const middleware = createValidationMiddleware(validationRules.adminAuth);
            expect(Array.isArray(middleware)).toBe(true);
            expect(middleware.length).toBeGreaterThan(1);
            expect(middleware[middleware.length - 1]).toBe(handleValidationErrors);
        });
    });

    describe('Module Exports', () => {
        test('should export all required functions and objects', () => {
            const validation = require('../../middleware/validation');

            expect(typeof validation.validationRules).toBe('object');
            expect(typeof validation.rateLimitRules).toBe('object');
            expect(typeof validation.handleValidationErrors).toBe('function');
            expect(typeof validation.createValidationMiddleware).toBe('function');
            expect(typeof validation.sanitizePath).toBe('function');
            expect(typeof validation.sanitizeHtml).toBe('function');
        });

        test('should not export unexpected properties', () => {
            const validation = require('../../middleware/validation');
            const expectedKeys = [
                'validationRules',
                'rateLimitRules',
                'handleValidationErrors',
                'createValidationMiddleware',
                'sanitizePath',
                'sanitizeHtml',
            ];

            const actualKeys = Object.keys(validation);
            expect(actualKeys.sort()).toEqual(expectedKeys.sort());
        });
    });

    describe('Integration Scenarios', () => {
        test('should work with Express-like middleware chain', () => {
            // Mock validation result for this test
            const mockErrors = { isEmpty: jest.fn().mockReturnValue(true) };
            validationResult.mockReturnValue(mockErrors);

            const testRules = [
                jest.fn((req, res, next) => next()),
                jest.fn((req, res, next) => next()),
            ];

            const middleware = createValidationMiddleware(testRules);

            // Simulate calling each middleware except the last one (handleValidationErrors)
            middleware.slice(0, -1).forEach(mw => {
                if (typeof mw === 'function') {
                    mw(req, res, next);
                }
            });

            expect(testRules[0]).toHaveBeenCalledWith(req, res, next);
            expect(testRules[1]).toHaveBeenCalledWith(req, res, next);
        });

        test('should handle complex sanitization scenarios', () => {
            const complexPath = '  ../../../<script>alert("xss")</script>/folder//file|name?.txt  ';
            const sanitized = sanitizePath(complexPath);

            expect(sanitized).not.toContain('..');
            expect(sanitized).not.toMatch(/[<>:"|?*]/);
            expect(sanitized).toBe('/scriptalert(xss)/script/folder/filename.txt');
            expect(sanitized.trim()).toBe(sanitized);
        });

        test('should provide comprehensive validation coverage', () => {
            // Test that all major validation types are covered
            const requiredRules = [
                'mediaRequest',
                'adminAuth',
                'configUpdate',
                'imageProxy',
                'cacheManagement',
                'search',
                'id',
                'adminRequest',
            ];

            requiredRules.forEach(ruleName => {
                expect(validationRules[ruleName]).toBeDefined();
                expect(Array.isArray(validationRules[ruleName])).toBe(true);
            });
        });

        test('should provide rate limiting for all endpoint types', () => {
            const requiredRateLimits = ['auth', 'api', 'media', 'admin'];

            requiredRateLimits.forEach(limitType => {
                expect(rateLimitRules[limitType]).toBeDefined();
                expect(typeof rateLimitRules[limitType].windowMs).toBe('number');
                expect(typeof rateLimitRules[limitType].max).toBe('number');
                expect(rateLimitRules[limitType].message).toBeDefined();
            });
        });
    });

    describe('Edge Cases and Security', () => {
        test('should handle very long paths safely', () => {
            const longPath = 'a'.repeat(1000) + '../../../etc/passwd';
            const sanitized = sanitizePath(longPath);
            expect(sanitized).not.toContain('..');
            expect(sanitized.length).toBeLessThan(longPath.length);
        });

        test('should handle multiple XSS attempts in HTML', () => {
            const xssAttempts = [
                '<script>alert("xss")</script>',
                '<img src="x" onerror="alert(1)">',
                '<div onload="alert(2)">content</div>',
                '&lt;script&gt;alert(3)&lt;/script&gt;',
            ].join('');

            const sanitized = sanitizeHtml(xssAttempts);
            expect(sanitized).not.toMatch(/[<>]/);
            // The function only removes < and > characters, so script text remains
            expect(sanitized).toContain('script');
        });

        test('should maintain rate limit security properties', () => {
            // Auth should have the strictest limits and longest window
            expect(rateLimitRules.auth.max).toBeLessThanOrEqual(5);
            expect(rateLimitRules.auth.windowMs).toBeGreaterThanOrEqual(15 * 60 * 1000);

            // All rate limits should skip successful requests for auth
            expect(rateLimitRules.auth.skipSuccessfulRequests).toBe(true);

            // All rate limits should use modern headers
            Object.values(rateLimitRules).forEach(config => {
                expect(config.standardHeaders).toBe(true);
                expect(config.legacyHeaders).toBe(false);
            });
        });

        test('should handle concurrent validation error handling', () => {
            const errors = [
                { path: 'field1', msg: 'Error 1', value: 'val1' },
                { path: 'field2', msg: 'Error 2', value: 'val2' },
            ];

            const mockErrors = {
                isEmpty: jest.fn().mockReturnValue(false),
                array: jest.fn().mockReturnValue(errors),
            };
            validationResult.mockReturnValue(mockErrors);

            // Simulate multiple concurrent validation calls
            const requests = Array(5)
                .fill()
                .map((_, i) => ({
                    ...req,
                    url: `/api/test${i}`,
                    method: 'POST',
                }));

            requests.forEach((request, i) => {
                const response = {
                    status: jest.fn().mockReturnThis(),
                    json: jest.fn().mockReturnThis(),
                };

                handleValidationErrors(request, response, next);

                expect(response.status).toHaveBeenCalledWith(400);
                expect(logger.warn).toHaveBeenCalledWith(
                    'Validation failed',
                    expect.objectContaining({
                        url: `/api/test${i}`,
                        method: 'POST',
                    })
                );
            });
        });
    });
});
