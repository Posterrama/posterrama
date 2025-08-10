const authManager = require('../utils/auth');
const {
    jwtAuth,
    apiKeyAuth,
    authenticate,
    requireRole
} = require('../middleware/auth');

// Mock dependencies
jest.mock('../utils/auth');

describe('Auth Middleware', () => {
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

    test('jwtAuth should authenticate valid JWT token', () => {
        const mockUser = { userId: 1, username: 'testuser' };
        req.headers.authorization = 'Bearer valid-token';
        authManager.verifyToken.mockReturnValue(mockUser);

        jwtAuth(req, res, next);

        expect(authManager.verifyToken).toHaveBeenCalledWith('valid-token');
        expect(req.user).toEqual(mockUser);
        expect(next).toHaveBeenCalled();
    });

    test('jwtAuth should reject request without authorization header', () => {
        jwtAuth(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Access token required' });
        expect(next).not.toHaveBeenCalled();
    });

    test('jwtAuth should reject invalid JWT token', () => {
        req.headers.authorization = 'Bearer invalid-token';
        authManager.verifyToken.mockImplementation(() => {
            throw new Error('Invalid token');
        });

        jwtAuth(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
    });

    test('apiKeyAuth should authenticate valid API key', () => {
        req.headers['x-api-key'] = 'valid-api-key';
        authManager.authenticateApiKey.mockReturnValue({
            userId: 1,
            permissions: ['read', 'write']
        });

        apiKeyAuth(req, res, next);

        expect(authManager.authenticateApiKey).toHaveBeenCalledWith('valid-api-key');
        expect(req.user.userId).toEqual(1);
        expect(next).toHaveBeenCalled();
    });

    test('apiKeyAuth should handle request without API key', () => {
        apiKeyAuth(req, res, next);

        expect(next).toHaveBeenCalled(); // Should continue to next middleware
    });

    test('authenticate should work with JWT', () => {
        const mockUser = { userId: 1, username: 'testuser' };
        req.headers.authorization = 'Bearer valid-token';
        authManager.verifyToken.mockReturnValue(mockUser);

        authenticate(req, res, next);

        expect(req.user).toEqual(mockUser);
        expect(next).toHaveBeenCalled();
    });

    test('requireRole should allow user with correct role', () => {
        req.user = { userId: 1, role: 'admin' };
        const middleware = requireRole('admin');

        middleware(req, res, next);

        expect(next).toHaveBeenCalled();
    });

    test('requireRole should reject user without required role', () => {
        req.user = { userId: 1, role: 'user' };
        const middleware = requireRole('admin');

        middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ error: 'Insufficient permissions' });
    });
});
