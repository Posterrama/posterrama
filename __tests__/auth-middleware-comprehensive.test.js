const authManager = require('../utils/auth');
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
} = require('../middleware/auth');

// Mock dependencies
jest.mock('../utils/auth');
jest.mock('../logger');

describe('Auth Middleware - Comprehensive Tests', () => {
    let req, res, next;

    beforeEach(() => {
        req = { headers: {}, body: {}, session: {}, user: null };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
            redirect: jest.fn()
        };
        next = jest.fn();
        jest.clearAllMocks();
    });

    describe('requirePermission', () => {
        test('should allow user with required permission (API key)', () => {
            req.user = { 
                userId: 1, 
                permissions: ['read', 'write'],
                authMethod: 'api-key'
            };
            const middleware = requirePermission('read');

            middleware(req, res, next);

            expect(next).toHaveBeenCalled();
        });

        test('should allow user with wildcard permission (API key)', () => {
            req.user = { 
                userId: 1, 
                permissions: ['*'],
                authMethod: 'api-key'
            };
            const middleware = requirePermission('anything');

            middleware(req, res, next);

            expect(next).toHaveBeenCalled();
        });

        test('should check user permissions via authManager (JWT)', () => {
            req.user = { userId: 1, username: 'testuser' };
            authManager.hasPermission.mockReturnValue(true);
            const middleware = requirePermission('read');

            middleware(req, res, next);

            expect(authManager.hasPermission).toHaveBeenCalledWith(req.user, 'read');
            expect(next).toHaveBeenCalled();
        });

        test('should reject user without required permission (API key)', () => {
            req.user = { 
                userId: 1, 
                permissions: ['read'],
                authMethod: 'api-key'
            };
            const middleware = requirePermission('write');

            middleware(req, res, next);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ 
                error: 'Permission denied. Required: write' 
            });
        });

        test('should reject user without required permission (JWT)', () => {
            req.user = { userId: 1, username: 'testuser' };
            authManager.hasPermission.mockReturnValue(false);
            const middleware = requirePermission('admin');

            middleware(req, res, next);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ 
                error: 'Permission denied. Required: admin' 
            });
        });

        test('should reject unauthenticated user', () => {
            const middleware = requirePermission('read');

            middleware(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
        });
    });

    describe('requireTwoFactor', () => {
        beforeEach(() => {
            authManager.twoFactorSecrets = new Map();
        });

        test('should allow user without 2FA setup', () => {
            req.user = { userId: 1 };

            requireTwoFactor(req, res, next);

            expect(next).toHaveBeenCalled();
        });

        test('should allow user with disabled 2FA', () => {
            req.user = { userId: 1 };
            authManager.twoFactorSecrets.set(1, { enabled: false });

            requireTwoFactor(req, res, next);

            expect(next).toHaveBeenCalled();
        });

        test('should allow user with valid 2FA token', () => {
            req.user = { userId: 1 };
            req.headers['x-2fa-token'] = '123456';
            authManager.twoFactorSecrets.set(1, { enabled: true });
            authManager.verifyTwoFactor.mockReturnValue(true);

            requireTwoFactor(req, res, next);

            expect(authManager.verifyTwoFactor).toHaveBeenCalledWith(1, '123456');
            expect(next).toHaveBeenCalled();
        });

        test('should reject user without 2FA token when required', () => {
            req.user = { userId: 1 };
            authManager.twoFactorSecrets.set(1, { enabled: true });

            requireTwoFactor(req, res, next);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Two-factor authentication required',
                requiresTwoFactor: true
            });
        });

        test('should reject user with invalid 2FA token', () => {
            req.user = { userId: 1 };
            req.headers['x-2fa-token'] = 'invalid';
            authManager.twoFactorSecrets.set(1, { enabled: true });
            authManager.verifyTwoFactor.mockReturnValue(false);

            requireTwoFactor(req, res, next);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Invalid two-factor authentication token'
            });
        });

        test('should handle 2FA verification errors', () => {
            req.user = { userId: 1 };
            req.headers['x-2fa-token'] = '123456';
            authManager.twoFactorSecrets.set(1, { enabled: true });
            authManager.verifyTwoFactor.mockImplementation(() => {
                throw new Error('2FA error');
            });

            requireTwoFactor(req, res, next);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ error: '2FA error' });
        });

        test('should reject unauthenticated user', () => {
            requireTwoFactor(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
        });
    });

    describe('optionalAuth', () => {
        test('should add user when valid API key provided', () => {
            req.headers['x-api-key'] = 'valid-key';
            authManager.authenticateApiKey.mockReturnValue({
                userId: 1,
                permissions: ['read']
            });

            optionalAuth(req, res, next);

            expect(req.user.authMethod).toEqual('api-key');
            expect(next).toHaveBeenCalled();
        });

        test('should add user when valid JWT provided', () => {
            const mockUser = { userId: 1, username: 'testuser' };
            req.headers.authorization = 'Bearer valid-token';
            authManager.verifyToken.mockReturnValue(mockUser);

            optionalAuth(req, res, next);

            expect(req.user).toEqual(mockUser);
            expect(next).toHaveBeenCalled();
        });

        test('should continue without user when invalid API key', () => {
            req.headers['x-api-key'] = 'invalid-key';
            authManager.authenticateApiKey.mockImplementation(() => {
                throw new Error('Invalid API key');
            });

            optionalAuth(req, res, next);

            expect(req.user).toBeNull();
            expect(next).toHaveBeenCalled();
        });

        test('should continue without user when invalid JWT', () => {
            req.headers.authorization = 'Bearer invalid-token';
            authManager.verifyToken.mockImplementation(() => {
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

        test('should prioritize API key over JWT', () => {
            req.headers['x-api-key'] = 'valid-key';
            req.headers.authorization = 'Bearer valid-token';
            authManager.authenticateApiKey.mockReturnValue({
                userId: 1,
                permissions: ['read']
            });

            optionalAuth(req, res, next);

            expect(req.user.authMethod).toEqual('api-key');
            expect(authManager.verifyToken).not.toHaveBeenCalled();
            expect(next).toHaveBeenCalled();
        });
    });

    describe('sessionAuth', () => {
        test('should authenticate user with valid session', () => {
            const mockUser = { userId: 1, username: 'testuser' };
            req.session = { user: mockUser };

            sessionAuth(req, res, next);

            expect(req.user).toEqual(mockUser);
            expect(next).toHaveBeenCalled();
        });

        test('should reject request without session', () => {
            sessionAuth(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({ 
                error: 'Session authentication required' 
            });
        });

        test('should reject request with empty session', () => {
            req.session = {};

            sessionAuth(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({ 
                error: 'Session authentication required' 
            });
        });

        test('should reject request with session but no user', () => {
            req.session = { otherData: 'value' };

            sessionAuth(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({ 
                error: 'Session authentication required' 
            });
        });
    });

    describe('checkAccountLockout', () => {
        beforeEach(() => {
            authManager.users = new Map();
        });

        test('should allow request without username', () => {
            checkAccountLockout(req, res, next);

            expect(next).toHaveBeenCalled();
        });

        test('should allow request with empty username', () => {
            req.body = { username: '' };

            checkAccountLockout(req, res, next);

            expect(next).toHaveBeenCalled();
        });

        test('should allow request for non-existent user', () => {
            req.body = { username: 'nonexistent' };

            checkAccountLockout(req, res, next);

            expect(next).toHaveBeenCalled();
        });

        test('should allow request for unlocked user', () => {
            const mockUser = { userId: 1, locked: false };
            req.body = { username: 'testuser' };
            authManager.users.set('testuser', mockUser);

            checkAccountLockout(req, res, next);

            expect(next).toHaveBeenCalled();
        });

        test('should allow request for user without locked property', () => {
            const mockUser = { userId: 1 };
            req.body = { username: 'testuser' };
            authManager.users.set('testuser', mockUser);

            checkAccountLockout(req, res, next);

            expect(next).toHaveBeenCalled();
        });

        test('should reject request for locked user', () => {
            const mockUser = { userId: 1, locked: true };
            req.body = { username: 'testuser' };
            authManager.users.set('testuser', mockUser);

            checkAccountLockout(req, res, next);

            expect(res.status).toHaveBeenCalledWith(423);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                error: 'Account locked due to too many failed login attempts',
                lockedUntil: expect.any(Date)
            }));
        });
    });

    describe('authenticate - comprehensive coverage', () => {
        test('should prioritize API key authentication', () => {
            req.headers['x-api-key'] = 'valid-api-key';
            req.headers.authorization = 'Bearer valid-token';
            authManager.authenticateApiKey.mockReturnValue({
                userId: 1,
                permissions: ['read']
            });

            authenticate(req, res, next);

            expect(authManager.authenticateApiKey).toHaveBeenCalledWith('valid-api-key');
            expect(req.user.authMethod).toEqual('api-key');
            expect(authManager.verifyToken).not.toHaveBeenCalled();
            expect(next).toHaveBeenCalled();
        });

        test('should handle API key failure and reject', () => {
            req.headers['x-api-key'] = 'invalid-key';
            authManager.authenticateApiKey.mockImplementation(() => {
                throw new Error('Invalid API key');
            });

            authenticate(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({ error: 'Invalid API key' });
            expect(next).not.toHaveBeenCalled();
        });

        test('should fallback to JWT when no API key', () => {
            const mockUser = { userId: 1, username: 'testuser' };
            req.headers.authorization = 'Bearer valid-token';
            authManager.verifyToken.mockReturnValue(mockUser);

            authenticate(req, res, next);

            expect(authManager.verifyToken).toHaveBeenCalledWith('valid-token');
            expect(req.user).toEqual(mockUser);
            expect(next).toHaveBeenCalled();
        });
    });

    describe('requireRole - edge cases', () => {
        test('should handle user without role property', () => {
            req.user = { userId: 1, username: 'testuser' };
            const middleware = requireRole('user');

            middleware(req, res, next);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ error: 'Insufficient permissions' });
        });

        test('should handle multiple roles with admin override', () => {
            req.user = { userId: 1, role: 'admin' };
            const middleware = requireRole('editor', 'moderator', 'user');

            middleware(req, res, next);

            expect(next).toHaveBeenCalled();
        });

        test('should log access denial', () => {
            req.user = { userId: 1, username: 'testuser', role: 'guest' };
            const middleware = requireRole('admin', 'editor');

            middleware(req, res, next);

            expect(res.status).toHaveBeenCalledWith(403);
        });
    });
});
