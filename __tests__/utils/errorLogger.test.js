/**
 * Tests for ErrorLogger utility (Issue #6)
 */

const ErrorLogger = require('../../utils/errorLogger');
const logger = require('../../utils/logger');

// Mock logger
jest.mock('../../utils/logger', () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
}));

describe('ErrorLogger', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('log', () => {
        it('should log error with full context', () => {
            const error = new Error('Test error');
            const context = {
                operation: 'test operation',
                module: 'test-module',
                requestId: 'req-123',
                userId: 'user-456',
                metadata: { key: 'value' },
            };

            const result = ErrorLogger.log(error, context);

            expect(logger.error).toHaveBeenCalled();
            expect(result).toMatchObject({
                errorMessage: 'Test error',
                errorName: 'Error',
                operation: 'test operation',
                module: 'test-module',
                requestId: 'req-123',
                userId: 'user-456',
            });
            expect(result.timestamp).toBeDefined();
            expect(result.metadata).toEqual({ key: 'value' });
        });

        it('should use default values for missing context', () => {
            const error = new Error('Test error');

            const result = ErrorLogger.log(error);

            expect(result.operation).toBe('unknown');
            expect(result.module).toBe('unknown');
            expect(result.requestId).toBeUndefined();
            expect(result.userId).toBeUndefined();
        });

        it('should handle error with code', () => {
            const error = new Error('Test error');
            error.code = 'ENOENT';

            const result = ErrorLogger.log(error);

            expect(result.errorCode).toBe('ENOENT');
        });

        it('should handle error with statusCode', () => {
            const error = new Error('Test error');
            error.statusCode = 404;

            const result = ErrorLogger.log(error);

            expect(result.errorCode).toBe(404);
        });

        it('should handle non-Error objects', () => {
            const error = 'String error';

            const result = ErrorLogger.log(error);

            expect(result.errorMessage).toBe('String error');
            expect(result.errorName).toBe('Error');
        });

        it('should remove null and undefined values', () => {
            const error = new Error('Test error');
            const context = {
                requestId: null,
                userId: undefined,
            };

            const result = ErrorLogger.log(error, context);

            expect(result.requestId).toBeUndefined();
            expect(result.userId).toBeUndefined();
        });

        it('should support different log levels', () => {
            const error = new Error('Test error');

            ErrorLogger.log(error, {}, 'warn');
            expect(logger.warn).toHaveBeenCalled();
            expect(logger.error).not.toHaveBeenCalled();

            jest.clearAllMocks();

            ErrorLogger.log(error, {}, 'info');
            expect(logger.info).toHaveBeenCalled();
            expect(logger.error).not.toHaveBeenCalled();
        });
    });

    describe('sanitizeStack', () => {
        it('should sanitize absolute paths', () => {
            const stack = `Error: test
    at Object.<anonymous> (/var/www/posterrama/utils/test.js:10:5)
    at Module._compile (/var/www/posterrama/node_modules/module.js:20:3)`;

            const sanitized = ErrorLogger.sanitizeStack(stack);

            expect(sanitized).toContain('./utils/test.js');
            expect(sanitized).toContain('./node_modules/module.js');
            expect(sanitized).not.toContain('/var/www/posterrama');
        });

        it('should handle null stack', () => {
            const sanitized = ErrorLogger.sanitizeStack(null);
            expect(sanitized).toBeNull();
        });

        it('should handle undefined stack', () => {
            const sanitized = ErrorLogger.sanitizeStack(undefined);
            expect(sanitized).toBeNull();
        });

        it('should preserve stack structure', () => {
            const stack = `Error: test
    at line1
    at line2
    at line3`;

            const sanitized = ErrorLogger.sanitizeStack(stack);
            const lines = sanitized.split('\n');

            expect(lines).toHaveLength(4);
        });
    });

    describe('sanitizeMetadata', () => {
        it('should redact password fields', () => {
            const metadata = {
                username: 'user123',
                password: 'secret123',
                data: 'normal',
            };

            const sanitized = ErrorLogger.sanitizeMetadata(metadata);

            expect(sanitized.username).toBe('user123');
            expect(sanitized.password).toBe('[REDACTED]');
            expect(sanitized.data).toBe('normal');
        });

        it('should redact sensitive fields (case insensitive)', () => {
            const metadata = {
                password: 'mypass',
                Secret: 'mysecret',
                token: 'mytoken',
                apiKey: 'myapikey', // camelCase to match sensitiveKeys list
                authorization: 'Bearer xyz',
                cookie: 'session=abc',
            };

            const sanitized = ErrorLogger.sanitizeMetadata(metadata);

            expect(sanitized.Secret).toBe('[REDACTED]');
            expect(sanitized.token).toBe('[REDACTED]');
            expect(sanitized.apiKey).toBe('[REDACTED]');
            expect(sanitized.authorization).toBe('[REDACTED]');
            expect(sanitized.cookie).toBe('[REDACTED]');
        });

        it('should handle nested objects', () => {
            const metadata = {
                user: {
                    name: 'John',
                    password: 'secret',
                    profile: {
                        apiKey: 'key123',
                        email: 'john@example.com',
                    },
                },
            };

            const sanitized = ErrorLogger.sanitizeMetadata(metadata);

            expect(sanitized.user.name).toBe('John');
            expect(sanitized.user.password).toBe('[REDACTED]');
            expect(sanitized.user.profile.apiKey).toBe('[REDACTED]');
            expect(sanitized.user.profile.email).toBe('john@example.com');
        });

        it('should handle null metadata', () => {
            const sanitized = ErrorLogger.sanitizeMetadata(null);
            expect(sanitized).toEqual({});
        });

        it('should handle non-object metadata', () => {
            const sanitized = ErrorLogger.sanitizeMetadata('string');
            expect(sanitized).toEqual({});
        });

        it('should handle arrays', () => {
            const metadata = {
                items: [
                    { name: 'item1', secret: 'secret1' },
                    { name: 'item2', token: 'token2' },
                ],
            };

            const sanitized = ErrorLogger.sanitizeMetadata(metadata);

            expect(sanitized.items[0].name).toBe('item1');
            expect(sanitized.items[0].secret).toBe('[REDACTED]');
            expect(sanitized.items[1].name).toBe('item2');
            expect(sanitized.items[1].token).toBe('[REDACTED]');
        });
    });

    describe('logHttpError', () => {
        it('should extract request context', () => {
            const error = new Error('HTTP error');
            const req = {
                method: 'GET',
                path: '/api/test',
                id: 'req-123',
                ip: '127.0.0.1',
                headers: {},
                get: jest.fn().mockReturnValue('Mozilla/5.0'),
                query: { page: '1' },
                params: { id: '123' },
                session: { user: { username: 'testuser' } },
            };

            const result = ErrorLogger.logHttpError(error, req, { custom: 'data' });

            expect(result.operation).toBe('GET /api/test');
            expect(result.module).toBe('http');
            expect(result.requestId).toBe('req-123');
            expect(result.userId).toBe('testuser');
            expect(result.metadata.ip).toBe('127.0.0.1');
            expect(result.metadata.userAgent).toBe('Mozilla/5.0');
            expect(result.metadata.query).toEqual({ page: '1' });
            expect(result.metadata.custom).toBe('data');
        });

        it('should truncate long user agent', () => {
            const error = new Error('HTTP error');
            const longUserAgent = 'a'.repeat(200);
            const req = {
                method: 'GET',
                path: '/api/test',
                ip: '127.0.0.1',
                headers: {},
                get: jest.fn().mockReturnValue(longUserAgent),
                query: {},
                params: {},
            };

            const result = ErrorLogger.logHttpError(error, req);

            expect(result.metadata.userAgent).toHaveLength(100);
        });

        it('should handle missing session', () => {
            const error = new Error('HTTP error');
            const req = {
                method: 'GET',
                path: '/api/test',
                ip: '127.0.0.1',
                headers: {},
                get: jest.fn().mockReturnValue('Mozilla/5.0'),
                query: {},
                params: {},
            };

            const result = ErrorLogger.logHttpError(error, req);

            expect(result.userId).toBeUndefined();
        });
    });

    describe('logExternalApiError', () => {
        it('should log external API errors with service context', () => {
            const error = new Error('API timeout');
            error.code = 'ETIMEDOUT';

            const result = ErrorLogger.logExternalApiError(error, 'jellyfin', '/Users', {
                hostname: 'localhost',
                port: 8096,
            });

            expect(result.operation).toBe('jellyfin API call');
            expect(result.module).toBe('external-api');
            expect(result.metadata.service).toBe('jellyfin');
            expect(result.metadata.endpoint).toBe('/Users');
            expect(result.metadata.hostname).toBe('localhost');
        });
    });

    describe('logWebSocketError', () => {
        it('should log WebSocket errors with device context', () => {
            const error = new Error('Connection lost');

            const result = ErrorLogger.logWebSocketError(error, 'device-123', {
                ip: '192.168.1.100',
                action: 'authentication',
            });

            expect(result.operation).toBe('WebSocket communication');
            expect(result.module).toBe('websocket');
            expect(result.metadata.deviceId).toBe('device-123');
            expect(result.metadata.ip).toBe('192.168.1.100');
            expect(result.metadata.action).toBe('authentication');
        });
    });

    describe('logDatabaseError', () => {
        it('should log database errors', () => {
            const error = new Error('Connection refused');
            error.code = 'ECONNREFUSED';

            const result = ErrorLogger.logDatabaseError(error, 'SELECT users', {
                table: 'users',
                query: 'SELECT * FROM users',
            });

            expect(result.operation).toBe('SELECT users');
            expect(result.module).toBe('database');
            expect(result.metadata.table).toBe('users');
        });
    });

    describe('logCacheError', () => {
        it('should log cache errors', () => {
            const error = new Error('Cache full');

            const result = ErrorLogger.logCacheError(error, 'set', {
                key: 'cache-key-123',
                size: 1024000,
            });

            expect(result.operation).toBe('set');
            expect(result.module).toBe('cache');
            expect(result.metadata.key).toBe('cache-key-123');
        });
    });

    describe('logFileSystemError', () => {
        it('should log filesystem errors', () => {
            const error = new Error('File not found');
            error.code = 'ENOENT';

            const result = ErrorLogger.logFileSystemError(error, 'readFile', {
                path: '/path/to/file.txt',
            });

            expect(result.operation).toBe('readFile');
            expect(result.module).toBe('filesystem');
            expect(result.errorCode).toBe('ENOENT');
        });
    });

    describe('logValidationError', () => {
        it('should log validation errors as warnings', () => {
            const error = new Error('Invalid email format');

            const result = ErrorLogger.logValidationError(error, 'email', {
                value: 'invalid-email',
            });

            expect(result.operation).toBe('validation');
            expect(result.module).toBe('validator');
            expect(result.metadata.field).toBe('email');
            expect(logger.warn).toHaveBeenCalled();
            expect(logger.error).not.toHaveBeenCalled();
        });
    });
});
