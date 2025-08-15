// Renamed from auth-manager.test.js to auth.comprehensive.test.js
const speakeasy = require('speakeasy');
const authManager = require('../../utils/auth');

function resetAuth() {
  authManager.refreshTokens.clear();
  authManager.apiKeys.clear();
  authManager.sessions.clear();
  authManager.roles.clear();
  authManager.users.clear();
  authManager.authAttempts.clear();
  authManager.twoFactorSecrets.clear();
  if (authManager.passwordResetTokens) authManager.passwordResetTokens.clear();
  authManager.initializeDefaults();
}

describe('AuthenticationManager core flows (comprehensive)', () => {
    it('authenticateUser success returns token, refreshToken, sessionId and user info', async () => {
        const result = await authManager.authenticateUser('admin', 'admin123');
        expect(result.token).toBeDefined();
        expect(result.refreshToken).toBeDefined();
        expect(result.sessionId).toBeDefined();
        expect(result.user.username).toBe('admin');
        expect(result.user.role).toBe('admin');
    });

    it('should reject invalid username formats', async () => {
        await expect(authManager.authenticateUser('', 'admin123')).rejects.toThrow('Invalid credentials');
        await expect(authManager.authenticateUser('admin@invalid', 'admin123')).rejects.toThrow('Invalid credentials');
        await expect(authManager.authenticateUser(null, 'admin123')).rejects.toThrow('Invalid credentials');
    });

    it('should reject invalid password formats', async () => {
        await expect(authManager.authenticateUser('admin', '')).rejects.toThrow('Invalid credentials');
        await expect(authManager.authenticateUser('admin', null)).rejects.toThrow('Invalid credentials');
        await expect(authManager.authenticateUser('admin', 'a')).rejects.toThrow('Invalid credentials');
    });

    it('should verify tokens correctly', () => {
        const user = { id: 1, username: 'admin', role: 'admin' };
        const token = authManager.generateToken(user);
        const decoded = authManager.verifyToken(token);
        expect(decoded.userId).toBe(1);
        expect(decoded.username).toBe('admin');
    });

    it('should reject invalid tokens', () => {
        expect(() => authManager.verifyToken('')).toThrow('Invalid token');
        expect(() => authManager.verifyToken(null)).toThrow('Invalid token');
        expect(() => authManager.verifyToken('invalid-token')).toThrow('Invalid token');
    });

    it('should cleanup expired sessions', () => {
        const cleanedCount = authManager.cleanupExpiredSessions();
        expect(typeof cleanedCount).toBe('number');
    });

    it('should validate API keys', () => {
        const keyData = authManager.authenticateApiKey('valid-api-key-123');
        expect(keyData.key).toBe('valid-api-key-123');
        
        expect(() => authManager.authenticateApiKey('')).toThrow('Invalid API key');
        expect(() => authManager.authenticateApiKey(null)).toThrow('Invalid API key');
        expect(() => authManager.authenticateApiKey('invalid-key')).toThrow('Invalid API key');
    });

    it('two-factor setup, verify, disable', async () => {
        // Setup 2FA
        const qrData = authManager.setupTwoFactor(1);
        expect(qrData.secret).toBeDefined();
        expect(qrData.qrCode).toBeDefined(); // Property is called qrCode, not qrCodeDataUrl
        
        // Verify 2FA - must use the secret without encoding as speakeasy expects base32 by default
        const token = speakeasy.totp({
            secret: qrData.secret,
            encoding: 'base32'
        });
        
        const isVerified = authManager.verifyTwoFactor(1, token);
        expect(isVerified).toBe(true);
        
        // Disable 2FA
        authManager.disableTwoFactor(1);
        const user = Array.from(authManager.users.values()).find(u => u.id === 1);
        expect(user.twoFactorEnabled).toBe(false);
    });
});
