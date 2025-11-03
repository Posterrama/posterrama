/**
 * AdminAuth Middleware - Branch Coverage Tests
 * Targets uncovered branches in adminAuth.js
 */

const { createAdminAuth, createAdminAuthDevices } = require('../../middleware/adminAuth');

describe('AdminAuth Middleware - Branch Coverage', () => {
    let mockLogger;
    let mockIsAuthenticated;
    let mockAdminAuth;
    let originalEnv;

    beforeEach(() => {
        originalEnv = process.env.NODE_ENV;
        mockLogger = {
            debug: jest.fn(),
        };
        mockIsAuthenticated = jest.fn((req, res, next) => next());
        mockAdminAuth = jest.fn((req, res, next) => next());
    });

    afterEach(() => {
        process.env.NODE_ENV = originalEnv;
        delete process.env.PRINT_AUTH_DEBUG;
    });

    describe('createAdminAuth', () => {
        describe('test environment', () => {
            beforeEach(() => {
                process.env.NODE_ENV = 'test';
            });

            test('accepts Authorization header in test mode', () => {
                const middleware = createAdminAuth({
                    isAuthenticated: mockIsAuthenticated,
                    logger: mockLogger,
                });
                const req = {
                    get: jest.fn().mockReturnValue('Bearer test-token'),
                    headers: {},
                    query: {},
                };
                const res = {};
                const next = jest.fn();

                middleware(req, res, next);

                expect(req.user).toEqual({ username: 'api_user', authMethod: 'apiKey' });
                expect(next).toHaveBeenCalled();
                expect(mockIsAuthenticated).not.toHaveBeenCalled();
            });

            test('accepts x-api-key header in test mode', () => {
                const middleware = createAdminAuth({
                    isAuthenticated: mockIsAuthenticated,
                    logger: mockLogger,
                });
                const req = {
                    get: jest.fn(header => {
                        if (header === 'x-api-key') return 'test-api-key';
                        return null;
                    }),
                    headers: {},
                    query: {},
                };
                const res = {};
                const next = jest.fn();

                middleware(req, res, next);

                expect(req.user).toEqual({ username: 'api_user', authMethod: 'apiKey' });
                expect(next).toHaveBeenCalled();
            });

            test('accepts query apiKey in test mode', () => {
                const middleware = createAdminAuth({
                    isAuthenticated: mockIsAuthenticated,
                    logger: mockLogger,
                });
                const req = {
                    get: jest.fn().mockReturnValue(null),
                    headers: {},
                    query: { apiKey: 'test-query-key' },
                };
                const res = {};
                const next = jest.fn();

                middleware(req, res, next);

                expect(req.user).toEqual({ username: 'api_user', authMethod: 'apiKey' });
                expect(next).toHaveBeenCalled();
            });

            test('accepts query apikey (lowercase) in test mode', () => {
                const middleware = createAdminAuth({
                    isAuthenticated: mockIsAuthenticated,
                    logger: mockLogger,
                });
                const req = {
                    get: jest.fn().mockReturnValue(null),
                    headers: {},
                    query: { apikey: 'test-query-key-lowercase' },
                };
                const res = {};
                const next = jest.fn();

                middleware(req, res, next);

                expect(req.user).toEqual({ username: 'api_user', authMethod: 'apiKey' });
                expect(next).toHaveBeenCalled();
            });

            test('falls through to real auth when no token in test mode', () => {
                const middleware = createAdminAuth({
                    isAuthenticated: mockIsAuthenticated,
                    logger: mockLogger,
                });
                const req = {
                    get: jest.fn().mockReturnValue(null),
                    headers: {},
                    query: {},
                };
                const res = {};
                const next = jest.fn();

                middleware(req, res, next);

                expect(mockIsAuthenticated).toHaveBeenCalledWith(req, res, next);
            });

            test('uses raw headers.authorization when req.get returns null', () => {
                const middleware = createAdminAuth({
                    isAuthenticated: mockIsAuthenticated,
                    logger: mockLogger,
                });
                const req = {
                    get: jest.fn().mockReturnValue(null),
                    headers: { authorization: 'Bearer raw-header-token' },
                    query: {},
                };
                const res = {};
                const next = jest.fn();

                middleware(req, res, next);

                expect(req.user).toEqual({ username: 'api_user', authMethod: 'apiKey' });
                expect(next).toHaveBeenCalled();
            });

            test('uses raw headers[x-api-key] when req.get returns null', () => {
                const middleware = createAdminAuth({
                    isAuthenticated: mockIsAuthenticated,
                    logger: mockLogger,
                });
                const req = {
                    get: jest.fn().mockReturnValue(null),
                    headers: { 'x-api-key': 'raw-api-key' },
                    query: {},
                };
                const res = {};
                const next = jest.fn();

                middleware(req, res, next);

                expect(req.user).toEqual({ username: 'api_user', authMethod: 'apiKey' });
                expect(next).toHaveBeenCalled();
            });

            test('logs debug info when PRINT_AUTH_DEBUG=1', () => {
                process.env.PRINT_AUTH_DEBUG = '1';
                const middleware = createAdminAuth({
                    isAuthenticated: mockIsAuthenticated,
                    logger: mockLogger,
                });
                const req = {
                    get: jest.fn().mockReturnValue('Bearer test-token'),
                    headers: {},
                    query: {},
                    path: '/admin/test',
                };
                const res = {};
                const next = jest.fn();

                middleware(req, res, next);

                expect(mockLogger.debug).toHaveBeenCalledWith(
                    '[ADMIN AUTH DEBUG]',
                    expect.objectContaining({
                        env: 'test',
                        path: '/admin/test',
                    })
                );
            });

            test('handles debug logging errors gracefully', () => {
                process.env.PRINT_AUTH_DEBUG = '1';
                const throwingLogger = {
                    debug: jest.fn(() => {
                        throw new Error('Logger error');
                    }),
                };
                const middleware = createAdminAuth({
                    isAuthenticated: mockIsAuthenticated,
                    logger: throwingLogger,
                });
                const req = {
                    get: jest.fn().mockReturnValue('Bearer test-token'),
                    headers: {},
                    query: {},
                    path: '/admin/test',
                };
                const res = {};
                const next = jest.fn();

                // Should not throw
                expect(() => middleware(req, res, next)).not.toThrow();
                expect(next).toHaveBeenCalled();
            });

            test('masks short API keys in debug output', () => {
                process.env.PRINT_AUTH_DEBUG = '1';
                const middleware = createAdminAuth({
                    isAuthenticated: mockIsAuthenticated,
                    logger: mockLogger,
                });
                const req = {
                    get: jest.fn(header => {
                        if (header === 'x-api-key') return 'short';
                        return null;
                    }),
                    headers: {},
                    query: {},
                    path: '/admin/test',
                };
                const res = {};
                const next = jest.fn();

                middleware(req, res, next);

                expect(mockLogger.debug).toHaveBeenCalledWith(
                    '[ADMIN AUTH DEBUG]',
                    expect.objectContaining({
                        xApiKey: '***',
                    })
                );
            });

            test('masks long API keys in debug output', () => {
                process.env.PRINT_AUTH_DEBUG = '1';
                const middleware = createAdminAuth({
                    isAuthenticated: mockIsAuthenticated,
                    logger: mockLogger,
                });
                const req = {
                    get: jest.fn(header => {
                        if (header === 'Authorization') return 'Bearer verylongtoken12345';
                        return null;
                    }),
                    headers: {},
                    query: {},
                    path: '/admin/test',
                };
                const res = {};
                const next = jest.fn();

                middleware(req, res, next);

                expect(mockLogger.debug).toHaveBeenCalledWith(
                    '[ADMIN AUTH DEBUG]',
                    expect.objectContaining({
                        authHeader: 'Bear...2345', // 4 chars shown by mask logic
                    })
                );
            });
        });

        describe('production environment', () => {
            beforeEach(() => {
                process.env.NODE_ENV = 'production';
            });

            test('always uses real auth in production', () => {
                const middleware = createAdminAuth({
                    isAuthenticated: mockIsAuthenticated,
                    logger: mockLogger,
                });
                const req = {
                    get: jest.fn().mockReturnValue('Bearer test-token'),
                    headers: {},
                    query: {},
                };
                const res = {};
                const next = jest.fn();

                middleware(req, res, next);

                expect(mockIsAuthenticated).toHaveBeenCalledWith(req, res, next);
                expect(req.user).toBeUndefined();
            });
        });
    });

    describe('createAdminAuthDevices', () => {
        describe('test environment', () => {
            beforeEach(() => {
                process.env.NODE_ENV = 'test';
            });

            test('bypasses auth with Authorization header in test mode', () => {
                const middleware = createAdminAuthDevices({
                    adminAuth: mockAdminAuth,
                    logger: mockLogger,
                });
                const req = {
                    get: jest.fn().mockReturnValue('Bearer device-token'),
                    headers: {},
                    query: {},
                };
                const res = {};
                const next = jest.fn();

                middleware(req, res, next);

                expect(req.user).toEqual({ username: 'api_user', authMethod: 'test-bypass' });
                expect(next).toHaveBeenCalled();
                expect(mockAdminAuth).not.toHaveBeenCalled();
            });

            test('bypasses auth with x-api-key header in test mode', () => {
                const middleware = createAdminAuthDevices({
                    adminAuth: mockAdminAuth,
                    logger: mockLogger,
                });
                const req = {
                    get: jest.fn(header => {
                        if (header === 'x-api-key') return 'device-api-key';
                        return null;
                    }),
                    headers: {},
                    query: {},
                };
                const res = {};
                const next = jest.fn();

                middleware(req, res, next);

                expect(req.user).toEqual({ username: 'api_user', authMethod: 'test-bypass' });
                expect(next).toHaveBeenCalled();
            });

            test('bypasses auth with query apiKey in test mode', () => {
                const middleware = createAdminAuthDevices({
                    adminAuth: mockAdminAuth,
                    logger: mockLogger,
                });
                const req = {
                    get: jest.fn().mockReturnValue(null),
                    headers: {},
                    query: { apiKey: 'device-query-key' },
                };
                const res = {};
                const next = jest.fn();

                middleware(req, res, next);

                expect(req.user).toEqual({ username: 'api_user', authMethod: 'test-bypass' });
                expect(next).toHaveBeenCalled();
            });

            test('uses raw headers when req.get returns null', () => {
                const middleware = createAdminAuthDevices({
                    adminAuth: mockAdminAuth,
                    logger: mockLogger,
                });
                const req = {
                    get: jest.fn().mockReturnValue(null),
                    headers: { authorization: 'Bearer raw-device-token' },
                    query: {},
                };
                const res = {};
                const next = jest.fn();

                middleware(req, res, next);

                expect(req.user).toEqual({ username: 'api_user', authMethod: 'test-bypass' });
                expect(next).toHaveBeenCalled();
            });

            test('falls through to adminAuth when no token in test mode', () => {
                const middleware = createAdminAuthDevices({
                    adminAuth: mockAdminAuth,
                    logger: mockLogger,
                });
                const req = {
                    get: jest.fn().mockReturnValue(null),
                    headers: {},
                    query: {},
                };
                const res = {};
                const next = jest.fn();

                middleware(req, res, next);

                expect(mockAdminAuth).toHaveBeenCalledWith(req, res, next);
            });

            test('logs debug info when PRINT_AUTH_DEBUG=1', () => {
                process.env.PRINT_AUTH_DEBUG = '1';
                const middleware = createAdminAuthDevices({
                    adminAuth: mockAdminAuth,
                    logger: mockLogger,
                });
                const req = {
                    get: jest.fn().mockReturnValue('Bearer device-token'),
                    headers: {},
                    query: {},
                    method: 'POST',
                    path: '/api/devices/register',
                };
                const res = {};
                const next = jest.fn();

                middleware(req, res, next);

                expect(mockLogger.debug).toHaveBeenCalledWith(
                    '[ADMIN AUTH DEVICES BYPASS?]',
                    'POST',
                    '/api/devices/register',
                    {
                        hasAnyAuth: true,
                    }
                );
            });

            test('handles debug logging errors gracefully', () => {
                process.env.PRINT_AUTH_DEBUG = '1';
                const throwingLogger = {
                    debug: jest.fn(() => {
                        throw new Error('Logger error');
                    }),
                };
                const middleware = createAdminAuthDevices({
                    adminAuth: mockAdminAuth,
                    logger: throwingLogger,
                });
                const req = {
                    get: jest.fn().mockReturnValue('Bearer device-token'),
                    headers: {},
                    query: {},
                    method: 'POST',
                    path: '/api/devices/register',
                };
                const res = {};
                const next = jest.fn();

                // Should not throw
                expect(() => middleware(req, res, next)).not.toThrow();
                expect(next).toHaveBeenCalled();
            });
        });

        describe('production environment', () => {
            beforeEach(() => {
                process.env.NODE_ENV = 'production';
            });

            test('always uses adminAuth in production', () => {
                const middleware = createAdminAuthDevices({
                    adminAuth: mockAdminAuth,
                    logger: mockLogger,
                });
                const req = {
                    get: jest.fn().mockReturnValue('Bearer device-token'),
                    headers: {},
                    query: {},
                };
                const res = {};
                const next = jest.fn();

                middleware(req, res, next);

                expect(mockAdminAuth).toHaveBeenCalledWith(req, res, next);
                expect(req.user).toBeUndefined();
            });
        });
    });
});
