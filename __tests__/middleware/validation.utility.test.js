// Simple validation utility function tests
const {
    sanitizePath,
    sanitizeHtml,
    createValidationMiddleware,
    rateLimitRules,
} = require('../../middleware/validation');

describe('Validation Utilities - Function Tests', () => {
    describe('sanitizePath', () => {
        it('should remove path traversal attempts', () => {
            expect(sanitizePath('../../../etc/passwd')).toBe('/etc/passwd');
            expect(sanitizePath('folder/../file.txt')).toBe('folder/file.txt');
            expect(sanitizePath('../../bad/path')).toBe('/bad/path');
        });

        it('should remove dangerous characters', () => {
            expect(sanitizePath('file<name>:with|bad?chars*')).toBe('filenamewithbadchars');
            expect(sanitizePath('test<script>alert()</script>')).toBe('testscriptalert()/script');
        });

        it('should normalize multiple slashes', () => {
            expect(sanitizePath('folder///subfolder//file.txt')).toBe('folder/subfolder/file.txt');
            expect(sanitizePath('////multiple////slashes')).toBe('/multiple/slashes');
        });

        it('should trim whitespace', () => {
            expect(sanitizePath('  /folder/file.txt  ')).toBe('/folder/file.txt');
            expect(sanitizePath('   test   ')).toBe('test');
        });

        it('should handle non-string input', () => {
            expect(sanitizePath(null)).toBe('');
            expect(sanitizePath(undefined)).toBe('');
            expect(sanitizePath(123)).toBe('');
            expect(sanitizePath({})).toBe('');
            expect(sanitizePath([])).toBe('');
            expect(sanitizePath(true)).toBe('');
        });

        it('should handle empty string', () => {
            expect(sanitizePath('')).toBe('');
        });
    });

    describe('sanitizeHtml', () => {
        it('should remove HTML tags', () => {
            expect(sanitizeHtml('<script>alert("xss")</script>')).toBe('scriptalert("xss")/script');
            expect(sanitizeHtml('<div>content</div>')).toBe('divcontent/div');
            expect(sanitizeHtml('<p>test</p>')).toBe('ptest/p');
            expect(sanitizeHtml('<>content<>')).toBe('content');
        });

        it('should trim whitespace', () => {
            expect(sanitizeHtml('  content  ')).toBe('content');
            expect(sanitizeHtml('   test   ')).toBe('test');
        });

        it('should handle non-string input', () => {
            expect(sanitizeHtml(null)).toBe('');
            expect(sanitizeHtml(undefined)).toBe('');
            expect(sanitizeHtml(123)).toBe('');
            expect(sanitizeHtml({})).toBe('');
            expect(sanitizeHtml([])).toBe('');
            expect(sanitizeHtml(true)).toBe('');
        });

        it('should handle empty string', () => {
            expect(sanitizeHtml('')).toBe('');
        });

        it('should handle mixed content', () => {
            expect(sanitizeHtml('<div>Hello <b>World</b></div>')).toBe('divHello bWorld/b/div');
        });
    });

    describe('createValidationMiddleware', () => {
        it('should return array with rules and error handler', () => {
            const mockRules = ['rule1', 'rule2'];
            const middleware = createValidationMiddleware(mockRules);

            expect(Array.isArray(middleware)).toBe(true);
            expect(middleware).toHaveLength(3);
            expect(middleware[0]).toBe('rule1');
            expect(middleware[1]).toBe('rule2');
            expect(typeof middleware[2]).toBe('function');
        });

        it('should handle empty rules array', () => {
            const middleware = createValidationMiddleware([]);

            expect(Array.isArray(middleware)).toBe(true);
            expect(middleware).toHaveLength(1);
            expect(typeof middleware[0]).toBe('function');
        });

        it('should handle single rule', () => {
            const middleware = createValidationMiddleware(['single-rule']);

            expect(middleware).toHaveLength(2);
            expect(middleware[0]).toBe('single-rule');
        });
    });

    describe('rateLimitRules', () => {
        it('should have auth rate limit configuration', () => {
            expect(rateLimitRules.auth).toBeDefined();
            expect(rateLimitRules.auth.windowMs).toBe(15 * 60 * 1000); // 15 minutes
            expect(rateLimitRules.auth.max).toBe(5);
            expect(rateLimitRules.auth.standardHeaders).toBe(true);
            expect(rateLimitRules.auth.legacyHeaders).toBe(false);
            expect(rateLimitRules.auth.skipSuccessfulRequests).toBe(true);
        });

        it('should have api rate limit configuration', () => {
            expect(rateLimitRules.api).toBeDefined();
            expect(rateLimitRules.api.windowMs).toBe(1 * 60 * 1000); // 1 minute
            expect(rateLimitRules.api.max).toBe(60);
        });

        it('should have media rate limit configuration', () => {
            expect(rateLimitRules.media).toBeDefined();
            expect(rateLimitRules.media.windowMs).toBe(1 * 60 * 1000); // 1 minute
            expect(rateLimitRules.media.max).toBe(100);
        });

        it('should have admin rate limit configuration', () => {
            expect(rateLimitRules.admin).toBeDefined();
            expect(rateLimitRules.admin.windowMs).toBe(1 * 60 * 1000); // 1 minute
            expect(rateLimitRules.admin.max).toBe(10);
        });

        it('should have proper error messages for rate limits', () => {
            expect(rateLimitRules.auth.message).toEqual({
                success: false,
                error: {
                    message: 'Too many authentication attempts, please try again later',
                    code: 429,
                },
            });

            expect(rateLimitRules.api.message).toEqual({
                success: false,
                error: {
                    message: 'Too many API requests, please slow down',
                    code: 429,
                },
            });

            expect(rateLimitRules.media.message).toEqual({
                success: false,
                error: {
                    message: 'Too many media requests, please slow down',
                    code: 429,
                },
            });

            expect(rateLimitRules.admin.message).toEqual({
                success: false,
                error: {
                    message: 'Too many admin requests, please slow down',
                    code: 429,
                },
            });
        });

        it('should have all required rate limit categories', () => {
            expect(rateLimitRules).toHaveProperty('auth');
            expect(rateLimitRules).toHaveProperty('api');
            expect(rateLimitRules).toHaveProperty('media');
            expect(rateLimitRules).toHaveProperty('admin');
        });
    });
});
