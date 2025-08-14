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
  beforeEach(() => { resetAuth(); });

  test('authenticateUser success returns token, refreshToken, sessionId and user info', async () => {
    const result = await authManager.authenticateUser('admin', 'admin123');
    expect(result.token).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(result.sessionId).toBeDefined();
    expect(result.user.username).toBe('admin');
  });

  test('two-factor setup, verify, disable', () => {
    const setup = authManager.setupTwoFactor(1);
    const token = speakeasy.totp({ secret: setup.secret });
    expect(authManager.verifyTwoFactor(1, token)).toBe(true);
    expect(authManager.disableTwoFactor(1)).toBe(true);
  });
});
