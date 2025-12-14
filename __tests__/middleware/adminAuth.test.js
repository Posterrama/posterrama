/**
 * @fileoverview Unit tests for middleware/adminAuth.js
 * @description Tests the admin authentication middleware factories.
 * Covers:
 * - createAdminAuth factory function
 * - createAdminAuthDevices factory function
 * - Test environment bypass behavior
 * - Production environment delegation to isAuthenticated
 * - Header normalization (Express getter vs raw headers)
 */

describe('Admin Auth Middleware', () => {
    let createAdminAuth;
    let createAdminAuthDevices;
    let mockIsAuthenticated;
    let mockLogger;
    let mockReq;
    let mockRes;
    let mockNext;

    beforeEach(() => {
        jest.resetModules();

        // Create mock dependencies
        mockIsAuthenticated = jest.fn((req, res, next) => next());
        mockLogger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        };

        // Load module
        const adminAuthModule = require('../../middleware/adminAuth');
        createAdminAuth = adminAuthModule.createAdminAuth;
        createAdminAuthDevices = adminAuthModule.createAdminAuthDevices;

        // Setup mock request
        mockReq = {
            headers: {},
            query: {},
            path: '/api/admin/test',
            get: jest.fn(header => {
                const lowerHeader = header.toLowerCase();
                if (lowerHeader === 'authorization') return mockReq.headers.authorization;
                if (lowerHeader === 'x-api-key') return mockReq.headers['x-api-key'];
                return undefined;
            }),
        };

        // Setup mock response
        mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
        };

        // Setup mock next
        mockNext = jest.fn();

        // Clear environment
        delete process.env.PRINT_AUTH_DEBUG;
    });

    afterEach(() => {
        jest.clearAllMocks();
        delete process.env.PRINT_AUTH_DEBUG;
    });

    describe('createAdminAuth', () => {
        it('should be a factory function', () => {
            expect(typeof createAdminAuth).toBe('function');
        });

        it('should return a middleware function', () => {
            const adminAuth = createAdminAuth({
                isAuthenticated: mockIsAuthenticated,
                logger: mockLogger,
            });

            expect(typeof adminAuth).toBe('function');
            expect(adminAuth.length).toBe(3); // (req, res, next)
        });

        describe('in test environment', () => {
            it('should allow request with Authorization header', () => {
                const adminAuth = createAdminAuth({
                    isAuthenticated: mockIsAuthenticated,
                    logger: mockLogger,
                });

                mockReq.headers.authorization = 'Bearer any-token';
                mockReq.get.mockImplementation(h => {
                    if (h.toLowerCase() === 'authorization') return 'Bearer any-token';
                    return undefined;
                });

                adminAuth(mockReq, mockRes, mockNext);

                expect(mockNext).toHaveBeenCalled();
                expect(mockIsAuthenticated).not.toHaveBeenCalled();
                expect(mockReq.user).toEqual({
                    username: 'api_user',
                    authMethod: 'apiKey',
                });
            });

            it('should allow request with X-API-Key header', () => {
                const adminAuth = createAdminAuth({
                    isAuthenticated: mockIsAuthenticated,
                    logger: mockLogger,
                });

                mockReq.headers['x-api-key'] = 'test-key';
                mockReq.get.mockImplementation(h => {
                    if (h.toLowerCase() === 'x-api-key') return 'test-key';
                    return undefined;
                });

                adminAuth(mockReq, mockRes, mockNext);

                expect(mockNext).toHaveBeenCalled();
                expect(mockReq.user.authMethod).toBe('apiKey');
            });

            it('should allow request with apiKey query parameter', () => {
                const adminAuth = createAdminAuth({
                    isAuthenticated: mockIsAuthenticated,
                    logger: mockLogger,
                });

                mockReq.query.apiKey = 'query-token';

                adminAuth(mockReq, mockRes, mockNext);

                expect(mockNext).toHaveBeenCalled();
            });

            it('should allow request with apikey query parameter (lowercase)', () => {
                const adminAuth = createAdminAuth({
                    isAuthenticated: mockIsAuthenticated,
                    logger: mockLogger,
                });

                mockReq.query.apikey = 'query-token';

                adminAuth(mockReq, mockRes, mockNext);

                expect(mockNext).toHaveBeenCalled();
            });

            it('should fall through to isAuthenticated when no auth provided', () => {
                const adminAuth = createAdminAuth({
                    isAuthenticated: mockIsAuthenticated,
                    logger: mockLogger,
                });

                adminAuth(mockReq, mockRes, mockNext);

                expect(mockIsAuthenticated).toHaveBeenCalledWith(mockReq, mockRes, mockNext);
            });

            it('should log debug info when PRINT_AUTH_DEBUG is set', () => {
                process.env.PRINT_AUTH_DEBUG = '1';
                const adminAuth = createAdminAuth({
                    isAuthenticated: mockIsAuthenticated,
                    logger: mockLogger,
                });

                mockReq.headers.authorization = 'Bearer token';
                mockReq.get.mockImplementation(h => {
                    if (h.toLowerCase() === 'authorization') return 'Bearer token';
                    return undefined;
                });

                adminAuth(mockReq, mockRes, mockNext);

                expect(mockLogger.debug).toHaveBeenCalledWith(
                    '[ADMIN AUTH DEBUG]',
                    expect.objectContaining({
                        env: 'test',
                        path: '/api/admin/test',
                    })
                );
            });

            it('should mask long API keys in debug logs', () => {
                process.env.PRINT_AUTH_DEBUG = '1';
                const adminAuth = createAdminAuth({
                    isAuthenticated: mockIsAuthenticated,
                    logger: mockLogger,
                });

                const longKey = 'abcdefghijklmnop';
                mockReq.headers['x-api-key'] = longKey;
                mockReq.get.mockImplementation(h => {
                    if (h.toLowerCase() === 'x-api-key') return longKey;
                    return undefined;
                });

                adminAuth(mockReq, mockRes, mockNext);

                // Should show masked key (first 4 + ... + last 4)
                expect(mockLogger.debug).toHaveBeenCalledWith(
                    '[ADMIN AUTH DEBUG]',
                    expect.objectContaining({
                        xApiKey: 'abcd...mnop',
                    })
                );
            });

            it('should handle empty string Authorization header', () => {
                const adminAuth = createAdminAuth({
                    isAuthenticated: mockIsAuthenticated,
                    logger: mockLogger,
                });

                mockReq.headers.authorization = '   ';
                mockReq.get.mockImplementation(h => {
                    if (h.toLowerCase() === 'authorization') return '   ';
                    return undefined;
                });

                adminAuth(mockReq, mockRes, mockNext);

                // Empty string (whitespace only) should fall through
                expect(mockIsAuthenticated).toHaveBeenCalled();
            });
        });

        describe('header normalization', () => {
            it('should check both Express getter and raw headers for Authorization', () => {
                const adminAuth = createAdminAuth({
                    isAuthenticated: mockIsAuthenticated,
                    logger: mockLogger,
                });

                // Only raw header set, not Express getter
                mockReq.headers.authorization = 'Bearer raw-token';
                mockReq.get.mockReturnValue(undefined);

                adminAuth(mockReq, mockRes, mockNext);

                expect(mockNext).toHaveBeenCalled();
            });

            it('should check both Express getter and raw headers for X-API-Key', () => {
                const adminAuth = createAdminAuth({
                    isAuthenticated: mockIsAuthenticated,
                    logger: mockLogger,
                });

                mockReq.headers['x-api-key'] = 'raw-key';
                mockReq.get.mockReturnValue(undefined);

                adminAuth(mockReq, mockRes, mockNext);

                expect(mockNext).toHaveBeenCalled();
            });
        });
    });

    describe('createAdminAuthDevices', () => {
        let mockAdminAuth;

        beforeEach(() => {
            mockAdminAuth = jest.fn((req, res, next) => next());
        });

        it('should be a factory function', () => {
            expect(typeof createAdminAuthDevices).toBe('function');
        });

        it('should return a middleware function', () => {
            const adminAuthDevices = createAdminAuthDevices({
                adminAuth: mockAdminAuth,
                logger: mockLogger,
            });

            expect(typeof adminAuthDevices).toBe('function');
            expect(adminAuthDevices.length).toBe(3);
        });

        describe('in test environment', () => {
            it('should bypass auth when Authorization header is present', () => {
                const adminAuthDevices = createAdminAuthDevices({
                    adminAuth: mockAdminAuth,
                    logger: mockLogger,
                });

                mockReq.headers.authorization = 'Bearer device-token';
                mockReq.get.mockImplementation(h => {
                    if (h.toLowerCase() === 'authorization') return 'Bearer device-token';
                    return undefined;
                });

                adminAuthDevices(mockReq, mockRes, mockNext);

                expect(mockNext).toHaveBeenCalled();
                expect(mockAdminAuth).not.toHaveBeenCalled();
                expect(mockReq.user).toEqual({
                    username: 'api_user',
                    authMethod: 'test-bypass',
                });
            });

            it('should bypass auth when X-API-Key header is present', () => {
                const adminAuthDevices = createAdminAuthDevices({
                    adminAuth: mockAdminAuth,
                    logger: mockLogger,
                });

                mockReq.headers['x-api-key'] = 'device-key';
                mockReq.get.mockImplementation(h => {
                    if (h.toLowerCase() === 'x-api-key') return 'device-key';
                    return undefined;
                });

                adminAuthDevices(mockReq, mockRes, mockNext);

                expect(mockNext).toHaveBeenCalled();
                expect(mockReq.user.authMethod).toBe('test-bypass');
            });

            it('should bypass auth when apiKey query param is present', () => {
                const adminAuthDevices = createAdminAuthDevices({
                    adminAuth: mockAdminAuth,
                    logger: mockLogger,
                });

                mockReq.query.apiKey = 'query-device-key';

                adminAuthDevices(mockReq, mockRes, mockNext);

                expect(mockNext).toHaveBeenCalled();
            });

            it('should fall through to adminAuth when no auth provided', () => {
                const adminAuthDevices = createAdminAuthDevices({
                    adminAuth: mockAdminAuth,
                    logger: mockLogger,
                });

                adminAuthDevices(mockReq, mockRes, mockNext);

                expect(mockAdminAuth).toHaveBeenCalledWith(mockReq, mockRes, mockNext);
            });

            it('should log debug when PRINT_AUTH_DEBUG is set', () => {
                process.env.PRINT_AUTH_DEBUG = '1';
                const adminAuthDevices = createAdminAuthDevices({
                    adminAuth: mockAdminAuth,
                    logger: mockLogger,
                });

                mockReq.headers.authorization = 'Bearer token';
                mockReq.get.mockImplementation(h => {
                    if (h.toLowerCase() === 'authorization') return 'Bearer token';
                    return undefined;
                });
                mockReq.method = 'GET';

                adminAuthDevices(mockReq, mockRes, mockNext);

                expect(mockLogger.debug).toHaveBeenCalledWith(
                    '[ADMIN AUTH DEVICES BYPASS?]',
                    'GET',
                    '/api/admin/test',
                    expect.objectContaining({
                        hasAnyAuth: true,
                    })
                );
            });
        });
    });

    describe('Edge cases', () => {
        it('should still work when req.get returns undefined but raw headers exist', () => {
            const adminAuth = createAdminAuth({
                isAuthenticated: mockIsAuthenticated,
                logger: mockLogger,
            });

            // Express getter returns undefined, but raw headers exist
            mockReq.get = jest.fn().mockReturnValue(undefined);
            mockReq.headers.authorization = 'Bearer token';

            // Should fall back to raw headers
            adminAuth(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalled();
        });

        it('should handle null query object', () => {
            const adminAuth = createAdminAuth({
                isAuthenticated: mockIsAuthenticated,
                logger: mockLogger,
            });

            mockReq.query = null;

            // Should not throw
            expect(() => {
                adminAuth(mockReq, mockRes, mockNext);
            }).not.toThrow();
        });

        it('should handle logger.debug throwing', () => {
            process.env.PRINT_AUTH_DEBUG = '1';
            mockLogger.debug.mockImplementation(() => {
                throw new Error('Logger error');
            });

            const adminAuth = createAdminAuth({
                isAuthenticated: mockIsAuthenticated,
                logger: mockLogger,
            });

            mockReq.headers.authorization = 'Bearer token';
            mockReq.get.mockReturnValue('Bearer token');

            // Should not throw - error is caught
            expect(() => {
                adminAuth(mockReq, mockRes, mockNext);
            }).not.toThrow();

            expect(mockNext).toHaveBeenCalled();
        });
    });

    describe('Production behavior simulation', () => {
        let originalNodeEnv;

        beforeEach(() => {
            originalNodeEnv = process.env.NODE_ENV;
        });

        afterEach(() => {
            process.env.NODE_ENV = originalNodeEnv;
        });

        it('should delegate to isAuthenticated in non-test environment', () => {
            // Reload module with different NODE_ENV
            jest.resetModules();
            process.env.NODE_ENV = 'production';

            const { createAdminAuth: prodCreateAdminAuth } = require('../../middleware/adminAuth');
            const adminAuth = prodCreateAdminAuth({
                isAuthenticated: mockIsAuthenticated,
                logger: mockLogger,
            });

            mockReq.headers.authorization = 'Bearer token';

            adminAuth(mockReq, mockRes, mockNext);

            // In production, should delegate to isAuthenticated
            expect(mockIsAuthenticated).toHaveBeenCalledWith(mockReq, mockRes, mockNext);
        });

        it('createAdminAuthDevices should delegate to adminAuth in production', () => {
            jest.resetModules();
            process.env.NODE_ENV = 'production';

            const {
                createAdminAuthDevices: prodCreateAdminAuthDevices,
            } = require('../../middleware/adminAuth');
            const prodMockAdminAuth = jest.fn((req, res, next) => next());
            const adminAuthDevices = prodCreateAdminAuthDevices({
                adminAuth: prodMockAdminAuth,
                logger: mockLogger,
            });

            mockReq.headers.authorization = 'Bearer token';

            adminAuthDevices(mockReq, mockRes, mockNext);

            expect(prodMockAdminAuth).toHaveBeenCalledWith(mockReq, mockRes, mockNext);
        });
    });
});
