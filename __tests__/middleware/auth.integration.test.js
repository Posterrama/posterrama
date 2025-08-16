// Mock authManager
const mockAuthManager = {
    verifyToken: jest.fn(),
    authenticateApiKey: jest.fn(),
    hasPermission: jest.fn(),
    twoFactorSecrets: new Map(),
    verifyTwoFactor: jest.fn(),
    users: new Map()
};
jest.mock('../../utils/auth', () => mockAuthManager);

// Mock logger
const mockLogger = {
    warn: jest.fn()
};
jest.mock('../../logger', () => mockLogger);

const authMiddleware = require('../../middleware/auth.js');
const { 
    jwtAuth, 
    apiKeyAuth, 
    authenticate, 
    requireRole, 
    requirePermission, 
    requireTwoFactor, 
    optionalAuth, 
    sessionAuth,
    checkAccountLockout
} = authMiddleware;

describe('Auth Middleware', () => {
    let req, res, next;

    beforeEach(() => {
        jest.clearAllMocks();
        
        req = {
            headers: {},
            body: {},
            session: {},
            user: null
        };
        
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis()
        };
        
        next = jest.fn();
    });

    describe('jwtAuth middleware', () => {
        test('should authenticate valid JWT token', () => {
            req.headers.authorization = 'Bearer valid-token';
            const mockUser = { userId: 'user1', username: 'testuser' };
            mockAuthManager.verifyToken.mockReturnValue(mockUser);
            
            jwtAuth(req, res, next);
            
            expect(mockAuthManager.verifyToken).toHaveBeenCalledWith('valid-token');
            expect(req.user).toEqual(mockUser);
            expect(next).toHaveBeenCalled();
        });

        test('should reject request without authorization header', () => {
            jwtAuth(req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({ error: 'Access token required' });
            expect(next).not.toHaveBeenCalled();
        });

        test('should reject request with invalid authorization format', () => {
            req.headers.authorization = 'Invalid format';
            
            jwtAuth(req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({ error: 'Access token required' });
            expect(next).not.toHaveBeenCalled();
        });

        test('should reject invalid JWT token', () => {
            req.headers.authorization = 'Bearer invalid-token';
            mockAuthManager.verifyToken.mockImplementation(() => {
                throw new Error('Invalid token');
            });
            
            jwtAuth(req, res, next);
            
            expect(mockLogger.warn).toHaveBeenCalledWith('JWT authentication failed:', 'Invalid token');
            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
            expect(next).not.toHaveBeenCalled();
        });
    });

    describe('apiKeyAuth middleware', () => {
        test('should authenticate valid API key', () => {
            req.headers['x-api-key'] = 'valid-api-key';
            const mockKeyData = { userId: 'user1', permissions: ['read'] };
            mockAuthManager.authenticateApiKey.mockReturnValue(mockKeyData);
            
            apiKeyAuth(req, res, next);
            
            expect(mockAuthManager.authenticateApiKey).toHaveBeenCalledWith('valid-api-key');
            expect(req.user).toEqual({
                userId: 'user1',
                permissions: ['read'],
                authMethod: 'api-key'
            });
            expect(next).toHaveBeenCalled();
        });

        test('should continue to next auth method when no API key', () => {
            apiKeyAuth(req, res, next);
            
            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });

        test('should reject invalid API key', () => {
            req.headers['x-api-key'] = 'invalid-key';
            mockAuthManager.authenticateApiKey.mockImplementation(() => {
                throw new Error('Invalid API key');
            });
            
            apiKeyAuth(req, res, next);
            
            expect(mockLogger.warn).toHaveBeenCalledWith('API key authentication failed:', 'Invalid API key');
            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({ error: 'Invalid API key' });
            expect(next).not.toHaveBeenCalled();
        });
    });

    describe('authenticate middleware', () => {
        test('should authenticate with API key first', () => {
            req.headers['x-api-key'] = 'valid-key';
            req.headers.authorization = 'Bearer valid-token';
            const mockKeyData = { userId: 'user1', permissions: ['read'] };
            mockAuthManager.authenticateApiKey.mockReturnValue(mockKeyData);
            
            authenticate(req, res, next);
            
            expect(mockAuthManager.authenticateApiKey).toHaveBeenCalledWith('valid-key');
            expect(req.user.authMethod).toBe('api-key');
            expect(next).toHaveBeenCalled();
        });

        test('should fallback to JWT when API key fails', () => {
            req.headers['x-api-key'] = 'invalid-key';
            req.headers.authorization = 'Bearer valid-token';
            const mockUser = { userId: 'user1', username: 'testuser' };
            
            mockAuthManager.authenticateApiKey.mockImplementation(() => {
                throw new Error('Invalid API key');
            });
            mockAuthManager.verifyToken.mockReturnValue(mockUser);
            
            authenticate(req, res, next);
            
            expect(mockLogger.warn).toHaveBeenCalledWith('API key authentication failed:', 'Invalid API key');
            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({ error: 'Invalid API key' });
        });

        test('should use JWT when no API key provided', () => {
            req.headers.authorization = 'Bearer valid-token';
            const mockUser = { userId: 'user1', username: 'testuser' };
            mockAuthManager.verifyToken.mockReturnValue(mockUser);
            
            authenticate(req, res, next);
            
            expect(mockAuthManager.verifyToken).toHaveBeenCalledWith('valid-token');
            expect(req.user).toEqual(mockUser);
            expect(next).toHaveBeenCalled();
        });
    });

    describe('requireRole middleware', () => {
        test('should allow user with required role', () => {
            const middleware = requireRole('user', 'moderator');
            req.user = { username: 'testuser', role: 'user' };
            
            middleware(req, res, next);
            
            expect(next).toHaveBeenCalled();
        });

        test('should allow admin user regardless of role requirement', () => {
            const middleware = requireRole('user');
            req.user = { username: 'testuser', role: 'admin' };
            
            middleware(req, res, next);
            
            expect(next).toHaveBeenCalled();
        });

        test('should reject unauthenticated user', () => {
            const middleware = requireRole('user');
            
            middleware(req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
            expect(next).not.toHaveBeenCalled();
        });

        test('should reject user with insufficient role', () => {
            const middleware = requireRole('admin');
            req.user = { username: 'testuser', role: 'user' };
            
            middleware(req, res, next);
            
            expect(mockLogger.warn).toHaveBeenCalledWith(
                'Access denied for user testuser with role user. Required roles: admin'
            );
            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ error: 'Insufficient permissions' });
            expect(next).not.toHaveBeenCalled();
        });
    });

    describe('requirePermission middleware', () => {
        test('should allow API key user with required permission', () => {
            const middleware = requirePermission('read:media');
            req.user = {
                userId: 'user1',
                permissions: ['read:media'],
                authMethod: 'api-key'
            };
            
            middleware(req, res, next);
            
            expect(next).toHaveBeenCalled();
        });

        test('should allow API key user with wildcard permission', () => {
            const middleware = requirePermission('read:media');
            req.user = {
                userId: 'user1',
                permissions: ['*'],
                authMethod: 'api-key'
            };
            
            middleware(req, res, next);
            
            expect(next).toHaveBeenCalled();
        });

        test('should allow JWT user with permission via authManager', () => {
            const middleware = requirePermission('read:media');
            req.user = { username: 'testuser', role: 'user' };
            mockAuthManager.hasPermission.mockReturnValue(true);
            
            middleware(req, res, next);
            
            expect(mockAuthManager.hasPermission).toHaveBeenCalledWith(req.user, 'read:media');
            expect(next).toHaveBeenCalled();
        });

        test('should reject unauthenticated user', () => {
            const middleware = requirePermission('read:media');
            
            middleware(req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
            expect(next).not.toHaveBeenCalled();
        });

        test('should reject API key user without permission', () => {
            const middleware = requirePermission('write:media');
            req.user = {
                userId: 'user1',
                permissions: ['read:media'],
                authMethod: 'api-key'
            };
            
            middleware(req, res, next);
            
            expect(mockLogger.warn).toHaveBeenCalledWith(
                'Permission denied for user user1. Required permission: write:media'
            );
            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ error: 'Permission denied. Required: write:media' });
            expect(next).not.toHaveBeenCalled();
        });

        test('should reject JWT user without permission', () => {
            const middleware = requirePermission('write:media');
            req.user = { username: 'testuser', role: 'user' };
            mockAuthManager.hasPermission.mockReturnValue(false);
            
            middleware(req, res, next);
            
            expect(mockLogger.warn).toHaveBeenCalledWith(
                'Permission denied for user testuser. Required permission: write:media'
            );
            expect(res.status).toHaveBeenCalledWith(403);
            expect(next).not.toHaveBeenCalled();
        });
    });

    describe('requireTwoFactor middleware', () => {
        test('should pass when user has no 2FA enabled', () => {
            req.user = { userId: 'user1', username: 'testuser' };
            
            requireTwoFactor(req, res, next);
            
            expect(next).toHaveBeenCalled();
        });

        test('should pass when 2FA is verified', () => {
            req.user = { userId: 'user1', username: 'testuser' };
            req.headers['x-2fa-token'] = '123456';
            mockAuthManager.twoFactorSecrets.set('user1', { enabled: true });
            mockAuthManager.verifyTwoFactor.mockReturnValue(true);
            
            requireTwoFactor(req, res, next);
            
            expect(mockAuthManager.verifyTwoFactor).toHaveBeenCalledWith('user1', '123456');
            expect(next).toHaveBeenCalled();
        });

        test('should reject unauthenticated user', () => {
            requireTwoFactor(req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
            expect(next).not.toHaveBeenCalled();
        });

        test('should require 2FA token when user has 2FA enabled', () => {
            req.user = { userId: 'user1', username: 'testuser' };
            mockAuthManager.twoFactorSecrets.set('user1', { enabled: true });
            
            requireTwoFactor(req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Two-factor authentication required',
                requiresTwoFactor: true
            });
            expect(next).not.toHaveBeenCalled();
        });

        test('should reject invalid 2FA token', () => {
            req.user = { userId: 'user1', username: 'testuser' };
            req.headers['x-2fa-token'] = 'invalid';
            mockAuthManager.twoFactorSecrets.set('user1', { enabled: true });
            mockAuthManager.verifyTwoFactor.mockReturnValue(false);
            
            requireTwoFactor(req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ error: 'Invalid two-factor authentication token' });
            expect(next).not.toHaveBeenCalled();
        });

        test('should handle 2FA verification errors', () => {
            req.user = { userId: 'user1', username: 'testuser' };
            req.headers['x-2fa-token'] = '123456';
            mockAuthManager.twoFactorSecrets.set('user1', { enabled: true });
            mockAuthManager.verifyTwoFactor.mockImplementation(() => {
                throw new Error('2FA verification failed');
            });
            
            requireTwoFactor(req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ error: '2FA verification failed' });
            expect(next).not.toHaveBeenCalled();
        });
    });

    describe('optionalAuth middleware', () => {
        test('should set user with valid API key', () => {
            req.headers['x-api-key'] = 'valid-key';
            const mockKeyData = { userId: 'user1', permissions: ['read'] };
            mockAuthManager.authenticateApiKey.mockReturnValue(mockKeyData);
            
            optionalAuth(req, res, next);
            
            expect(req.user).toEqual({
                userId: 'user1',
                permissions: ['read'],
                authMethod: 'api-key'
            });
            expect(next).toHaveBeenCalled();
        });

        test('should set user with valid JWT', () => {
            req.headers.authorization = 'Bearer valid-token';
            const mockUser = { userId: 'user1', username: 'testuser' };
            mockAuthManager.verifyToken.mockReturnValue(mockUser);
            
            optionalAuth(req, res, next);
            
            expect(req.user).toEqual(mockUser);
            expect(next).toHaveBeenCalled();
        });

        test('should continue without user when API key is invalid', () => {
            req.headers['x-api-key'] = 'invalid-key';
            mockAuthManager.authenticateApiKey.mockImplementation(() => {
                throw new Error('Invalid API key');
            });
            
            optionalAuth(req, res, next);
            
            expect(req.user).toBeNull();
            expect(next).toHaveBeenCalled();
        });

        test('should continue without user when JWT is invalid', () => {
            req.headers.authorization = 'Bearer invalid-token';
            mockAuthManager.verifyToken.mockImplementation(() => {
                throw new Error('Invalid token');
            });
            
            optionalAuth(req, res, next);
            
            expect(req.user).toBeNull();
            expect(next).toHaveBeenCalled();
        });

        test('should continue without user when no auth provided', () => {
            optionalAuth(req, res, next);
            
            expect(req.user).toBeNull();
            expect(next).toHaveBeenCalled();
        });
    });

    describe('sessionAuth middleware', () => {
        test('should authenticate valid session', () => {
            const mockUser = { userId: 'user1', username: 'testuser' };
            req.session = { user: mockUser };
            
            sessionAuth(req, res, next);
            
            expect(req.user).toEqual(mockUser);
            expect(next).toHaveBeenCalled();
        });

        test('should reject request without session', () => {
            sessionAuth(req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({ error: 'Session authentication required' });
            expect(next).not.toHaveBeenCalled();
        });

        test('should reject request with session but no user', () => {
            req.session = {};
            
            sessionAuth(req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({ error: 'Session authentication required' });
            expect(next).not.toHaveBeenCalled();
        });
    });

    describe('checkAccountLockout middleware', () => {
        test('should continue when no username provided', () => {
            checkAccountLockout(req, res, next);
            
            expect(next).toHaveBeenCalled();
        });

        test('should continue when user is not locked', () => {
            req.body = { username: 'testuser' };
            mockAuthManager.users.set('testuser', { locked: false });
            
            checkAccountLockout(req, res, next);
            
            expect(next).toHaveBeenCalled();
        });

        test('should continue when user does not exist', () => {
            req.body = { username: 'nonexistent' };
            
            checkAccountLockout(req, res, next);
            
            expect(next).toHaveBeenCalled();
        });

        test('should reject locked user account', () => {
            req.body = { username: 'lockeduser' };
            mockAuthManager.users.set('lockeduser', { locked: true });
            
            checkAccountLockout(req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(423);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Account locked due to too many failed login attempts',
                lockedUntil: expect.any(Date)
            });
            expect(next).not.toHaveBeenCalled();
        });
    });

    describe('Module exports', () => {
        test('should export all middleware functions', () => {
            expect(typeof jwtAuth).toBe('function');
            expect(typeof apiKeyAuth).toBe('function');
            expect(typeof authenticate).toBe('function');
            expect(typeof requireRole).toBe('function');
            expect(typeof requirePermission).toBe('function');
            expect(typeof requireTwoFactor).toBe('function');
            expect(typeof optionalAuth).toBe('function');
            expect(typeof sessionAuth).toBe('function');
            expect(typeof checkAccountLockout).toBe('function');
        });
    });

    describe('Edge cases', () => {
        test('should handle edge case gracefully', () => {
            const middleware = requireRole('user');
            req.user = { username: 'testuser', role: 'user' };
            
            middleware(req, res, next);
            
            expect(next).toHaveBeenCalled();
        });

        test('should handle middleware chaining', () => {
            const middleware1 = requireRole('user');
            const middleware2 = requirePermission('read');
            
            req.user = { username: 'testuser', role: 'user' };
            mockAuthManager.hasPermission.mockReturnValue(true);
            
            middleware1(req, res, () => {
                middleware2(req, res, next);
            });
            
            expect(next).toHaveBeenCalled();
        });
    });
});
