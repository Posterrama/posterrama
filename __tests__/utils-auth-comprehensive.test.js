const authManager = require('../utils/auth');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');

// Mock external dependencies
jest.mock('bcrypt');
jest.mock('jsonwebtoken');
jest.mock('crypto');
jest.mock('speakeasy');
jest.mock('qrcode');
jest.mock('../logger');

describe('AuthenticationManager - Comprehensive Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        
        // Reset authManager state
        authManager.users.clear();
        authManager.roles.clear();
        authManager.apiKeys.clear();
        authManager.sessions.clear();
        authManager.refreshTokens.clear();
        authManager.twoFactorSecrets.clear();
        authManager.authAttempts.clear();
        
        // Re-initialize defaults
        authManager.initializeDefaults();
        
        // Setup common mocks
        bcrypt.hashSync.mockReturnValue('hashed-password');
        bcrypt.compare.mockResolvedValue(true);
        jwt.sign.mockReturnValue('mock-jwt-token');
        jwt.verify.mockReturnValue({ userId: 1, username: 'testuser', role: 'user' });
        crypto.randomBytes.mockReturnValue(Buffer.from('mock-random-bytes'));
    });

    describe('Initialization', () => {
        test('should initialize with default users and roles', () => {
            expect(authManager.users.size).toBeGreaterThan(0);
            expect(authManager.roles.size).toBeGreaterThan(0);
            expect(authManager.users.has('admin')).toBe(true);
            expect(authManager.users.has('user')).toBe(true);
        });

        test('should create admin user with correct properties', () => {
            const admin = authManager.users.get('admin');
            expect(admin).toBeDefined();
            expect(admin.role).toBe('admin');
            expect(admin.username).toBe('admin');
            expect(admin.email).toBe('admin@example.com');
        });

        test('should create default roles with permissions', () => {
            const adminRole = authManager.roles.get('admin');
            const userRole = authManager.roles.get('user');
            
            expect(adminRole.permissions).toContain('*');
            expect(userRole.permissions).toContain('read:config');
        });

        test('should initialize API keys', () => {
            expect(authManager.apiKeys.size).toBeGreaterThan(0);
            expect(authManager.apiKeys.has('valid-api-key-123')).toBe(true);
        });
    });

    describe('JWT Token Management', () => {
        test('should generate JWT token for user', () => {
            const user = { id: 1, username: 'testuser', role: 'user' };
            
            const token = authManager.generateToken(user);
            
            expect(jwt.sign).toHaveBeenCalledWith(
                { userId: 1, username: 'testuser', role: 'user' },
                authManager.jwtSecret,
                { expiresIn: '1h' }
            );
            expect(token).toBe('mock-jwt-token');
        });

        test('should generate token with custom expiration', () => {
            const user = { id: 1, username: 'testuser', role: 'user' };
            
            authManager.generateToken(user, '24h');
            
            expect(jwt.sign).toHaveBeenCalledWith(
                expect.any(Object),
                expect.any(String),
                { expiresIn: '24h' }
            );
        });

        test('should verify JWT token', () => {
            const token = 'valid-token';
            
            const decoded = authManager.verifyToken(token);
            
            expect(jwt.verify).toHaveBeenCalledWith(token, authManager.jwtSecret);
            expect(decoded).toEqual({ userId: 1, username: 'testuser', role: 'user' });
        });

        test('should throw error for invalid token', () => {
            jwt.verify.mockImplementation(() => {
                throw new Error('Invalid token');
            });
            
            expect(() => authManager.verifyToken('invalid-token')).toThrow('Invalid token');
        });

        test('should generate refresh token', () => {
            const userId = 1;
            
            const refreshToken = authManager.generateRefreshToken(userId);
            
            expect(crypto.randomBytes).toHaveBeenCalledWith(32);
            expect(authManager.refreshTokens.has(refreshToken)).toBe(true);
        });

        test('should refresh JWT token with valid refresh token', () => {
            const userId = 1;
            const refreshToken = authManager.generateRefreshToken(userId);
            const user = authManager.users.get('admin'); // Get a real user
            
            const result = authManager.refreshToken(refreshToken);
            
            expect(result).toBeDefined();
            expect(result.token).toBe('mock-jwt-token');
        });

        test('should reject invalid refresh token', () => {
            expect(() => authManager.refreshToken('invalid-refresh-token')).toThrow();
        });

        test('should reject expired refresh token', () => {
            const userId = 1;
            const refreshToken = authManager.generateRefreshToken(userId);
            
            // Manually expire the token
            const tokenData = authManager.refreshTokens.get(refreshToken);
            tokenData.expiresAt = new Date(Date.now() - 1000); // Expired 1 second ago
            
            expect(() => authManager.refreshToken(refreshToken)).toThrow();
        });

        test('should revoke refresh token', () => {
            const userId = 1;
            const refreshToken = authManager.generateRefreshToken(userId);
            
            authManager.revokeRefreshToken(refreshToken);
            
            expect(authManager.refreshTokens.has(refreshToken)).toBe(false);
        });
    });

    describe('User Authentication', () => {
        test('should authenticate user with valid credentials', async () => {
            const username = 'admin';
            const password = 'admin123';
            
            const result = await authManager.authenticateUser(username, password);
            
            expect(bcrypt.compare).toHaveBeenCalledWith(password, expect.any(String));
            expect(result).toHaveProperty('token');
            expect(result).toHaveProperty('refreshToken');
            expect(result).toHaveProperty('sessionId');
            expect(result.user).toHaveProperty('username', username);
        });

        test('should reject non-existent user', async () => {
            await expect(authManager.authenticateUser('nonexistent', 'password'))
                .rejects.toThrow('Invalid credentials or account locked');
        });

        test('should reject user with invalid password', async () => {
            bcrypt.compare.mockResolvedValue(false);
            
            await expect(authManager.authenticateUser('admin', 'wrongpassword'))
                .rejects.toThrow('Invalid credentials');
        });

        test('should reject locked user', async () => {
            const admin = authManager.users.get('admin');
            admin.locked = true;
            
            await expect(authManager.authenticateUser('admin', 'admin123'))
                .rejects.toThrow('Invalid credentials or account locked');
        });

        test('should update last login on successful authentication', async () => {
            const admin = authManager.users.get('admin');
            const initialLastLogin = admin.lastLogin;
            
            await authManager.authenticateUser('admin', 'admin123');
            
            expect(admin.lastLogin).not.toBe(initialLastLogin);
            expect(admin.lastLogin).toBeInstanceOf(Date);
        });

        test('should reset failed attempts on successful login', async () => {
            const admin = authManager.users.get('admin');
            admin.failedAttempts = 3;
            
            await authManager.authenticateUser('admin', 'admin123');
            
            expect(admin.failedAttempts).toBe(0);
        });
    });

    describe('Failed Login Attempts and Account Lockout', () => {
        test('should record failed attempts', () => {
            const username = 'admin';
            const admin = authManager.users.get(username);
            
            authManager.recordFailedAttempt(username);
            
            expect(admin.failedAttempts).toBe(1);
        });

        test('should lock account after 5 failed attempts', () => {
            const username = 'admin';
            const admin = authManager.users.get(username);
            
            // Simulate 5 failed attempts
            for (let i = 0; i < 5; i++) {
                authManager.recordFailedAttempt(username);
            }
            
            expect(admin.locked).toBe(true);
        });

        test('should track IP-based attempts', () => {
            const username = 'admin';
            
            authManager.recordFailedAttempt(username);
            
            const attempts = authManager.authAttempts.get(`failed_${username}`);
            expect(attempts).toBeDefined();
            expect(attempts.count).toBe(1);
        });

        test('should handle failed attempts for non-existent user', () => {
            // Should not throw error
            expect(() => authManager.recordFailedAttempt('nonexistent')).not.toThrow();
        });
    });

    describe('API Key Authentication', () => {
        test('should authenticate valid API key', () => {
            const result = authManager.authenticateApiKey('valid-api-key-123');
            
            expect(result).toBeDefined();
            expect(result.userId).toBe(1);
            expect(result.permissions).toContain('read:config');
        });

        test('should reject invalid API key', () => {
            expect(() => authManager.authenticateApiKey('invalid-key'))
                .toThrow('Invalid API key');
        });

        test('should update last used timestamp', () => {
            const initialLastUsed = authManager.apiKeys.get('valid-api-key-123').lastUsed;
            
            authManager.authenticateApiKey('valid-api-key-123');
            
            const updatedLastUsed = authManager.apiKeys.get('valid-api-key-123').lastUsed;
            expect(updatedLastUsed).not.toBe(initialLastUsed);
        });

        test('should create new API key', () => {
            const result = authManager.createApiKey(1, 'New Test Key', ['read:all']);
            
            expect(result).toHaveProperty('key');
            expect(result).toHaveProperty('name', 'New Test Key');
            expect(authManager.apiKeys.has(result.key)).toBe(true);
        });

        test('should list API keys for user', () => {
            const keys = authManager.getApiKeys(1);
            
            expect(Array.isArray(keys)).toBe(true);
            expect(keys.length).toBeGreaterThan(0);
            expect(keys[0]).not.toHaveProperty('key'); // Should not expose actual key
        });

        test('should revoke API key', () => {
            const result = authManager.revokeApiKey('valid-api-key-123');
            
            expect(result).toBe(true);
            expect(authManager.apiKeys.has('valid-api-key-123')).toBe(false);
        });

        test('should return false when revoking non-existent key', () => {
            const result = authManager.revokeApiKey('non-existent-key');
            
            expect(result).toBe(false);
        });
    });

    describe('Session Management', () => {
        test('should create session on login', async () => {
            const result = await authManager.authenticateUser('admin', 'admin123');
            
            expect(authManager.sessions.has(result.sessionId)).toBe(true);
        });

        test('should validate active session', async () => {
            const result = await authManager.authenticateUser('admin', 'admin123');
            
            const isValid = authManager.validateSession(result.sessionId);
            
            expect(isValid).toBe(true);
        });

        test('should invalidate non-existent session', () => {
            const isValid = authManager.validateSession('non-existent-session');
            
            expect(isValid).toBe(false);
        });

        test('should invalidate expired session', async () => {
            const result = await authManager.authenticateUser('admin', 'admin123');
            
            // Manually expire the session
            const session = authManager.sessions.get(result.sessionId);
            session.lastActivity = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours ago
            
            const isValid = authManager.validateSession(result.sessionId);
            
            expect(isValid).toBe(false);
        });

        test('should logout user and invalidate session', () => {
            const sessionId = 'test-session';
            authManager.sessions.set(sessionId, { userId: 1 });
            
            authManager.logout(sessionId);
            
            expect(authManager.sessions.has(sessionId)).toBe(false);
        });

        test('should logout from all sessions', () => {
            // Create multiple sessions for user
            authManager.sessions.set('session1', { userId: 1 });
            authManager.sessions.set('session2', { userId: 1 });
            authManager.sessions.set('session3', { userId: 2 }); // Different user
            
            const invalidated = authManager.logoutAllSessions(1);
            
            expect(invalidated).toBe(2); // Should invalidate 2 sessions for user 1
            expect(authManager.sessions.has('session1')).toBe(false);
            expect(authManager.sessions.has('session2')).toBe(false);
            expect(authManager.sessions.has('session3')).toBe(true); // Different user's session should remain
        });
    });

    describe('Role and Permission Management', () => {
        test('should check user permissions', () => {
            const user = { id: 1, role: 'admin' };
            
            const hasPermission = authManager.hasPermission(user, 'read:config');
            
            expect(hasPermission).toBe(true);
        });

        test('should check user permissions for regular user', () => {
            const user = { id: 2, role: 'user' };
            
            const hasReadPermission = authManager.hasPermission(user, 'read:config');
            const hasWritePermission = authManager.hasPermission(user, 'write:config');
            
            expect(hasReadPermission).toBe(true);
            expect(hasWritePermission).toBe(false);
        });

        test('should handle admin wildcard permissions', () => {
            const user = { id: 1, role: 'admin' };
            
            const hasAnyPermission = authManager.hasPermission(user, 'any:permission');
            
            expect(hasAnyPermission).toBe(true);
        });

        test('should return false for invalid role', () => {
            const user = { id: 1, role: 'invalid-role' };
            
            const hasPermission = authManager.hasPermission(user, 'read:config');
            
            expect(hasPermission).toBe(false);
        });

        test('should create new role', () => {
            const result = authManager.createRole('editor', ['read:all', 'write:posts']);
            
            expect(result).toBe(true);
            expect(authManager.roles.has('editor')).toBe(true);
        });

        test('should not create duplicate role', () => {
            expect(() => authManager.createRole('admin', ['read:all']))
                .toThrow('Role already exists');
        });

        test('should assign role to user', () => {
            authManager.createRole('editor', ['read:all', 'write:posts']);
            
            const result = authManager.assignRole(1, 'editor');
            
            expect(result).toBe(true);
            const user = authManager.users.get('admin');
            expect(user.role).toBe('editor');
        });

        test('should handle assigning invalid role', () => {
            const result = authManager.assignRole(1, 'invalid-role');
            
            expect(result).toBe(false);
        });
    });

    describe('Two-Factor Authentication', () => {
        beforeEach(() => {
            speakeasy.generateSecret.mockReturnValue({
                ascii: 'mock-secret',
                hex: 'mock-hex-secret',
                base32: 'mock-base32-secret',
                otpauth_url: 'otpauth://totp/test'
            });
            speakeasy.totp.verify.mockReturnValue(true);
            qrcode.toDataURL.mockResolvedValue('data:image/png;base64,mock-qr-code');
        });

        test('should enable 2FA for user', async () => {
            const result = await authManager.enableTwoFactor(1, 'Test App');
            
            expect(result).toHaveProperty('secret');
            expect(result).toHaveProperty('qrCodeUrl');
            expect(speakeasy.generateSecret).toHaveBeenCalled();
        });

        test('should generate QR code', async () => {
            const qrCode = await authManager.generateQRCode('mock-secret');
            
            expect(qrcode.toDataURL).toHaveBeenCalledWith('mock-secret');
            expect(qrCode).toBe('data:image/png;base64,mock-qr-code');
        });

        test('should verify 2FA token', () => {
            authManager.twoFactorSecrets.set(1, { 
                secret: 'mock-secret',
                enabled: true 
            });
            
            const isValid = authManager.verifyTwoFactor(1, '123456');
            
            expect(speakeasy.totp.verify).toHaveBeenCalledWith({
                secret: 'mock-secret',
                token: '123456',
                window: 2
            });
            expect(isValid).toBe(true);
        });

        test('should reject 2FA for user without setup', () => {
            expect(() => authManager.verifyTwoFactor(999, '123456'))
                .toThrow('Two-factor authentication not enabled');
        });

        test('should disable 2FA for user', () => {
            authManager.twoFactorSecrets.set(1, { 
                secret: 'mock-secret',
                enabled: true 
            });
            
            const result = authManager.disableTwoFactor(1);
            
            expect(result).toBe(true);
            expect(authManager.twoFactorSecrets.has(1)).toBe(false);
        });
    });

    describe('Password Management', () => {
        test('should validate password strength', () => {
            const weakPassword = '123';
            const strongPassword = 'StrongP@ssw0rd123';
            
            expect(authManager.validatePasswordStrength(weakPassword)).toBe(false);
            expect(authManager.validatePasswordStrength(strongPassword)).toBe(true);
        });

        test('should change user password', async () => {
            const userId = 1;
            const currentPassword = 'admin123';
            const newPassword = 'NewStrongP@ssw0rd';
            
            await authManager.changePassword(userId, currentPassword, newPassword);
            
            expect(bcrypt.compare).toHaveBeenCalledWith(currentPassword, expect.any(String));
            expect(bcrypt.hashSync).toHaveBeenCalledWith(newPassword, 10);
        });

        test('should reject password change with invalid current password', async () => {
            bcrypt.compare.mockResolvedValue(false);
            
            await expect(authManager.changePassword(1, 'wrong-password', 'new-password'))
                .rejects.toThrow('Current password is incorrect');
        });

        test('should reject weak new password', async () => {
            await expect(authManager.changePassword(1, 'admin123', 'weak'))
                .rejects.toThrow('Password requirements not met');
        });

        test('should generate password reset token', () => {
            const tokenData = authManager.generatePasswordResetToken('admin@example.com');
            
            expect(tokenData).toBeDefined();
            expect(tokenData.token).toBeDefined();
            expect(tokenData.expiresAt).toBeDefined();
            expect(crypto.randomBytes).toHaveBeenCalled();
        });

        test('should reset password with valid token', async () => {
            const email = 'admin@example.com';
            
            // Create a token and ensure the auth manager maintains state
            const tokenData = authManager.generatePasswordResetToken(email);
            const token = tokenData.token;
            
            const newPassword = 'NewResetP@ssw0rd';
            
            // The token should now be in the auth manager's token map
            await authManager.resetPassword(token, newPassword);
            
            expect(bcrypt.hashSync).toHaveBeenCalledWith(newPassword, 10);
        });

        test('should reject password reset with invalid token', async () => {
            await expect(authManager.resetPassword('invalid-token', 'new-password'))
                .rejects.toThrow('Invalid or expired reset token');
        });
    });

    describe('User Management', () => {
        test('should create new user', () => {
            const userData = {
                username: 'newuser',
                password: 'NewUserP@ssw0rd',
                email: 'newuser@example.com',
                role: 'user'
            };
            
            const result = authManager.createUser(userData);
            
            expect(result).toBeDefined();
            expect(authManager.users.has('newuser')).toBe(true);
            expect(bcrypt.hashSync).toHaveBeenCalledWith(userData.password, 10);
        });

        test('should not create user with existing username', () => {
            const userData = {
                username: 'admin', // Already exists
                password: 'password',
                email: 'test@example.com'
            };
            
            expect(() => authManager.createUser(userData))
                .toThrow('Username already exists');
        });

        test('should get user by ID', () => {
            const user = authManager.getUserById(1);
            
            expect(user).toBeDefined();
            expect(user.username).toBe('admin');
        });

        test('should return null for non-existent user ID', () => {
            const user = authManager.getUserById(999);
            
            expect(user).toBeNull();
        });

        test('should delete user', () => {
            const result = authManager.deleteUser(2); // Regular user
            
            expect(result).toBe(true);
            expect(authManager.users.has('user')).toBe(false);
        });

        test('should not delete non-existent user', () => {
            const result = authManager.deleteUser(999);
            
            expect(result).toBe(false);
        });
    });

    describe('Error Handling', () => {
        test('should handle JWT verification errors', () => {
            jwt.verify.mockImplementation(() => {
                throw new jwt.JsonWebTokenError('Invalid token');
            });
            
            expect(() => authManager.verifyToken('invalid-token'))
                .toThrow('Invalid token');
        });

        test('should handle bcrypt errors', async () => {
            bcrypt.compare.mockRejectedValue(new Error('Bcrypt error'));
            
            await expect(authManager.authenticateUser('admin', 'password'))
                .rejects.toThrow('Bcrypt error');
        });

        test('should handle QR code generation errors', async () => {
            qrcode.toDataURL.mockRejectedValue(new Error('QR generation failed'));
            
            await expect(authManager.generateQRCode('secret'))
                .rejects.toThrow('QR generation failed');
        });
    });
});
