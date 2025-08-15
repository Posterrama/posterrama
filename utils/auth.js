const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const logger = require('../logger');

class AuthenticationManager {
    constructor() {
        this.jwtSecret = process.env.JWT_SECRET || 'fallback-jwt-secret-key';
        this.refreshTokens = new Map(); // In production, use Redis
        this.apiKeys = new Map(); // In production, use database
        this.sessions = new Map(); // In production, use Redis
        this.users = new Map(); // In production, use database
        this.roles = new Map(); // In production, use database
        this.authAttempts = new Map(); // For rate limiting and lockout
        this.twoFactorSecrets = new Map(); // In production, use database
        
        // Initialize with default users and roles
        this.initializeDefaults();
    }

    initializeDefaults() {
        // Create default admin user
        const adminPasswordHash = bcrypt.hashSync('admin123', 10);
        this.users.set('admin', {
            id: 1,
            username: 'admin',
            password: adminPasswordHash,
            email: 'admin@example.com',
            role: 'admin',
            twoFactorEnabled: false,
            locked: false,
            failedAttempts: 0,
            lastLogin: null,
            createdAt: new Date()
        });

        // Create default regular user
        const userPasswordHash = bcrypt.hashSync('user123', 10);
        this.users.set('user', {
            id: 2,
            username: 'user',
            password: userPasswordHash,
            email: 'user@example.com',
            role: 'user',
            twoFactorEnabled: false,
            locked: false,
            failedAttempts: 0,
            lastLogin: null,
            createdAt: new Date()
        });

        // Create default roles
        this.roles.set('admin', {
            name: 'admin',
            permissions: ['*'] // All permissions
        });

        this.roles.set('user', {
            name: 'user',
            permissions: ['read:config', 'read:media']
        });

        this.roles.set('moderator', {
            name: 'moderator',
            permissions: ['read:all', 'write:media', 'delete:media']
        });

        // Create default API keys
        this.apiKeys.set('valid-api-key-123', {
            id: '1',
            name: 'Test API Key',
            key: 'valid-api-key-123',
            permissions: ['read:config', 'read:media'],
            userId: 1,
            createdAt: new Date(),
            lastUsed: null
        });

        // Start periodic cleanup (every hour)
        this.startCleanupScheduler();
    }

    startCleanupScheduler() {
        // Run cleanup every hour
        this.cleanupInterval = setInterval(() => {
            this.cleanupExpiredSessions();
        }, 60 * 60 * 1000); // 1 hour
        
        // Initial cleanup
        setTimeout(() => {
            this.cleanupExpiredSessions();
        }, 5000); // Wait 5 seconds after startup
    }

    stopCleanupScheduler() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }

    /**
     * Complete cleanup of all resources
     */
    cleanup() {
        this.stopCleanupScheduler();
        
        // Stop the additional cleanup interval
        if (this.additionalCleanupInterval) {
            clearInterval(this.additionalCleanupInterval);
            this.additionalCleanupInterval = null;
        }
        
        // Clear all data structures
        this.sessions.clear();
        this.refreshTokens.clear();
        this.blacklistedTokens.clear();
        this.loginAttempts.clear();
        this.rateLimitData.clear();
        this.twoFactorSecrets.clear();
        
        logger.debug('Authentication manager cleaned up');
    }

    // JWT Token Management
    generateToken(user, expiresIn = '1h') {
        const payload = {
            userId: user.id,
            username: user.username,
            role: user.role
        };
        
        return jwt.sign(payload, this.jwtSecret, { expiresIn });
    }

    generateRefreshToken(userId) {
        const refreshToken = crypto.randomBytes(32).toString('hex');
        this.refreshTokens.set(refreshToken, {
            userId,
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
        });
        return refreshToken;
    }

    // Input validation helper
    validateInput(input, fieldName, options = {}) {
        if (input === null || input === undefined) {
            throw new Error(`${fieldName} is required`);
        }
        
        if (typeof input !== 'string') {
            throw new Error(`${fieldName} must be a string`);
        }
        
        if (input.trim().length === 0) {
            throw new Error(`${fieldName} cannot be empty`);
        }
        
        if (options.minLength && input.length < options.minLength) {
            throw new Error(`${fieldName} must be at least ${options.minLength} characters`);
        }
        
        if (options.maxLength && input.length > options.maxLength) {
            throw new Error(`${fieldName} must be no more than ${options.maxLength} characters`);
        }
        
        if (options.pattern && !options.pattern.test(input)) {
            throw new Error(`${fieldName} format is invalid`);
        }
        
        return input.trim();
    }

    verifyToken(token) {
        try {
            // Input validation
            if (!token || typeof token !== 'string') {
                throw new Error('Token is required and must be a string');
            }
            
            const decoded = jwt.verify(token, this.jwtSecret);
            
            // Additional validation
            if (!decoded.userId || !decoded.username) {
                throw new Error('Invalid token payload');
            }
            
            // Check if user still exists and is not locked
            const user = Array.from(this.users.values()).find(u => u.id === decoded.userId);
            if (!user || user.locked) {
                throw new Error('User no longer valid');
            }
            
            return decoded;
        } catch (error) {
            logger.warn(`Token verification failed: ${error.message}`);
            throw new Error('Invalid token');
        }
    }

    refreshToken(refreshToken) {
        const tokenData = this.refreshTokens.get(refreshToken);
        if (!tokenData || tokenData.expiresAt < new Date()) {
            throw new Error('Invalid or expired refresh token');
        }

        const user = Array.from(this.users.values()).find(u => u.id === tokenData.userId);
        if (!user) {
            throw new Error('User not found');
        }

        // Generate new tokens
        const newToken = this.generateToken(user);
        const newRefreshToken = this.generateRefreshToken(user.id);

        // Remove old refresh token
        this.refreshTokens.delete(refreshToken);

        return { token: newToken, refreshToken: newRefreshToken };
    }

    // Revoke refresh token (added to satisfy tests)
    revokeRefreshToken(refreshToken) {
        return this.refreshTokens.delete(refreshToken);
    }

    // User Authentication
    async authenticateUser(username, password) {
        // Input validation
        try {
            username = this.validateInput(username, 'Username', { 
                minLength: 2, 
                maxLength: 50,
                pattern: /^[a-zA-Z0-9_-]+$/ 
            });
            password = this.validateInput(password, 'Password', { 
                minLength: 3, 
                maxLength: 128 
            });
        } catch (error) {
            logger.warn(`Authentication failed due to invalid input: ${error.message}`);
            throw new Error('Invalid credentials');
        }

        const user = this.users.get(username);
        if (!user || user.locked) {
            this.recordFailedAttempt(username);
            throw new Error('Invalid credentials or account locked');
        }

        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
            this.recordFailedAttempt(username);
            throw new Error('Invalid credentials');
        }

        // Reset failed attempts on successful login
        user.failedAttempts = 0;
        user.lastLogin = new Date();

        // Generate tokens
        const token = this.generateToken(user);
        const refreshToken = this.generateRefreshToken(user.id);

        // Create session
        const sessionId = crypto.randomBytes(16).toString('hex');
        this.sessions.set(sessionId, {
            userId: user.id,
            username: user.username,
            createdAt: new Date(),
            lastActivity: new Date(),
            token
        });

        logger.info(`User ${username} logged in successfully`);

        return { 
            token, 
            refreshToken, 
            sessionId,
            user: { 
                id: user.id, 
                username: user.username, 
                role: user.role,
                twoFactorEnabled: user.twoFactorEnabled
            } 
        };
    }

    recordFailedAttempt(username) {
        const user = this.users.get(username);
        if (user) {
            user.failedAttempts = (user.failedAttempts || 0) + 1;
            
            // Lock account after 5 failed attempts
            if (user.failedAttempts >= 5) {
                user.locked = true;
                logger.warn(`Account ${username} locked due to too many failed attempts`);
            }
        }

        // Track IP-based attempts (simplified)
        const key = `failed_${username}`;
        const attempts = this.authAttempts.get(key) || { count: 0, lastAttempt: new Date() };
        attempts.count++;
        attempts.lastAttempt = new Date();
        this.authAttempts.set(key, attempts);
    }

    // Session cleanup - remove expired sessions
    cleanupExpiredSessions() {
        const now = new Date();
        const sessionTimeout = 24 * 60 * 60 * 1000; // 24 hours
        let cleanedCount = 0;
        
        for (const [sessionId, session] of this.sessions.entries()) {
            if (now - session.lastActivity > sessionTimeout) {
                this.sessions.delete(sessionId);
                cleanedCount++;
            }
        }
        
        // Also cleanup expired refresh tokens
        for (const [token, data] of this.refreshTokens.entries()) {
            if (data.expiresAt < now) {
                this.refreshTokens.delete(token);
                cleanedCount++;
            }
        }
        
        // Cleanup old failed attempts (after 1 hour)
        const attemptTimeout = 60 * 60 * 1000; // 1 hour
        for (const [key, attempt] of this.authAttempts.entries()) {
            if (now - attempt.lastAttempt > attemptTimeout) {
                this.authAttempts.delete(key);
            }
        }
        
        if (cleanedCount > 0) {
            logger.info(`Cleaned up ${cleanedCount} expired auth entries`);
        }
        
        return cleanedCount;
    }

    // API Key Authentication
    authenticateApiKey(apiKey) {
        // Input validation
        if (!apiKey || typeof apiKey !== 'string') {
            throw new Error('Invalid API key');
        }
        
        const keyData = this.apiKeys.get(apiKey);
        if (!keyData) {
            throw new Error('Invalid API key');
        }

        keyData.lastUsed = new Date();
        return keyData;
    }

    createApiKey(userId, name, permissions) { // reordered params to match tests (userId first)
        const apiKey = crypto.randomBytes(32).toString('hex');
        const keyData = {
            id: crypto.randomUUID(),
            name,
            key: apiKey,
            permissions,
            userId,
            createdAt: new Date(),
            lastUsed: null
        };

        this.apiKeys.set(apiKey, keyData);
        logger.info(`API key created: ${name} for user ${userId}`);

        return keyData;
    }

    // Alias expected by tests
    getApiKeys(userId) {
        return this.listApiKeys(userId);
    }

    listApiKeys(userId) {
        return Array.from(this.apiKeys.values())
            .filter(key => key.userId === userId)
            .map(key => ({
                id: key.id,
                name: key.name,
                permissions: key.permissions,
                createdAt: key.createdAt,
                lastUsed: key.lastUsed
            }));
    }

    revokeApiKey(identifier, userId) {
        // If identifier matches a stored API key value directly
        if (this.apiKeys.has(identifier) && (userId === undefined || this.apiKeys.get(identifier).userId === userId)) {
            const data = this.apiKeys.get(identifier);
            this.apiKeys.delete(identifier);
            logger.info(`API key revoked: ${data.name}`);
            return true;
        }
        // Fall back to searching by id
        for (const [apiKey, keyData] of this.apiKeys.entries()) {
            if (keyData.id === identifier && (userId === undefined || keyData.userId === userId)) {
                this.apiKeys.delete(apiKey);
                logger.info(`API key revoked by id: ${keyData.name}`);
                return true;
            }
        }
        return false;
    }

    revokeApiKeyValue(apiKey) {
        const existed = this.apiKeys.delete(apiKey);
        if (existed) logger.info(`API key revoked by value: ${apiKey}`);
        return existed;
    }

    // Two-Factor Authentication
    setupTwoFactor(userId) {
        const secret = speakeasy.generateSecret({
            name: 'Posterrama App',
            account: `user_${userId}`,
            length: 32
        });

        this.twoFactorSecrets.set(userId, {
            secret: secret.base32,
            enabled: false,
            backupCodes: this.generateBackupCodes()
        });

        return {
            secret: secret.base32,
            qrCode: secret.otpauth_url
        };
    }

    async generateQRCode(secret) {
        try {
            return await qrcode.toDataURL(secret);
        } catch (error) {
            throw new Error('QR generation failed');
        }
    }

    verifyTwoFactor(userId, token) {
        const twoFactorData = this.twoFactorSecrets.get(userId);
        if (!twoFactorData) {
            throw new Error('Two-factor authentication not enabled');
        }

        // Specify encoding explicitly to match secret generation
        const verifyArgs = {
            secret: twoFactorData.secret,
            token: token,
            encoding: 'base32',
            window: 2
        };
        const verified = speakeasy.totp.verify(verifyArgs);

        if (verified) {
            twoFactorData.enabled = true;
            logger.info(`Two-factor authentication verified for user ${userId}`);
        }

        return verified;
    }

    generateBackupCodes() {
        const codes = [];
        for (let i = 0; i < 10; i++) {
            codes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
        }
        return codes;
    }

    // Role-Based Access Control
    hasPermission(user, permission) {
        const role = this.roles.get(user.role);
        if (!role) return false;

        // Admin has all permissions
        if (role.permissions.includes('*')) return true;

        return role.permissions.includes(permission);
    }

    createRole(name, permissions) {
        if (this.roles.has(name)) {
            throw new Error('Role already exists');
        }

        const role = { name, permissions };
        this.roles.set(name, role);
        logger.info(`Role created: ${name} with permissions: ${permissions.join(', ')}`);
    return true; // tests expect boolean
    }

    assignRole(userRef, roleName) {
        // Accept username or userId (tests pass id)
        let user = typeof userRef === 'string' ? this.users.get(userRef) : Array.from(this.users.values()).find(u => u.id === userRef);
        const role = this.roles.get(roleName);
        if (!user) return false; // tests expect boolean false / true
        if (!role) return false;
        user.role = roleName;
        logger.info(`Role ${roleName} assigned to user ${user.username}`);
        return true;
    }

    // Session Management
    getSession(sessionId) {
        return this.sessions.get(sessionId);
    }

    validateSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) return false;
        const maxInactivity = 24 * 60 * 60 * 1000;
        if (Date.now() - session.lastActivity.getTime() > maxInactivity) {
            this.sessions.delete(sessionId);
            return false;
        }
        return true;
    }

    logout(sessionId) {
        return this.invalidateSession(sessionId);
    }

    logoutAllSessions(userId) {
        return this.invalidateAllSessions(userId);
    }

    getUserSessions(userId) {
        return Array.from(this.sessions.values())
            .filter(session => session.userId === userId);
    }

    invalidateSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session) {
            this.sessions.delete(sessionId);
            logger.info(`Session invalidated for user ${session.username}`);
            return true;
        }
        return false;
    }

    invalidateAllSessions(userId) {
        let count = 0;
        for (const [sessionId, session] of this.sessions.entries()) {
            if (session.userId === userId) {
                this.sessions.delete(sessionId);
                count++;
            }
        }
        logger.info(`${count} sessions invalidated for user ${userId}`);
        return count;
    }

    // Password Management
    validatePasswordComplexity(password) {
        const minLength = 8;
        const hasUpperCase = /[A-Z]/.test(password);
        const hasLowerCase = /[a-z]/.test(password);
        const hasNumbers = /\d/.test(password);
        const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

        const errors = [];
        if (password.length < minLength) {
            errors.push(`Password must be at least ${minLength} characters long`);
        }
        if (!hasUpperCase) {
            errors.push('Password must contain at least one uppercase letter');
        }
        if (!hasLowerCase) {
            errors.push('Password must contain at least one lowercase letter');
        }
        if (!hasNumbers) {
            errors.push('Password must contain at least one number');
        }
        if (!hasSpecialChar) {
            errors.push('Password must contain at least one special character');
        }

        return { valid: errors.length === 0, errors };
    }

    async changePassword(userId, currentPassword, newPassword) {
        const user = Array.from(this.users.values()).find(u => u.id === userId);
        if (!user) {
            throw new Error('User not found');
        }

        // Verify current password
        const isCurrentValid = await bcrypt.compare(currentPassword, user.password);
        if (!isCurrentValid) {
            throw new Error('Current password is incorrect');
        }

        // Validate new password
        const validation = this.validatePasswordComplexity(newPassword);
        if (!validation.valid) {
            throw new Error(`Password requirements not met: ${validation.errors.join(', ')}`);
        }

        // Hash and save new password
    // Tests expect hashSync usage
    user.password = bcrypt.hashSync(newPassword, 10);
        logger.info(`Password changed for user ${user.username}`);

        return true;
    }

    generatePasswordResetToken(email) {
        const user = Array.from(this.users.values()).find(u => u.email === email);
        if (!user) {
            throw new Error('User not found');
        }

        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetData = {
            userId: user.id,
            token: resetToken,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
            used: false
        };

        // In production, store this in database
        this.passwordResetTokens = this.passwordResetTokens || new Map();
        this.passwordResetTokens.set(resetToken, resetData);

        logger.info(`Password reset token generated for ${email}`);

        // In production, send email here
        return { token: resetToken, expiresAt: resetData.expiresAt };
    }

    async resetPassword(token, newPassword) {
        this.passwordResetTokens = this.passwordResetTokens || new Map();
        const resetData = this.passwordResetTokens.get(token);
        if (!resetData || resetData.used || resetData.expiresAt < new Date()) {
            throw new Error('Invalid or expired reset token');
        }

        // Validate new password
        const validation = this.validatePasswordComplexity(newPassword);
        if (!validation.valid) {
            throw new Error(`Password requirements not met: ${validation.errors.join(', ')}`);
        }

        const user = Array.from(this.users.values()).find(u => u.id === resetData.userId);
        if (!user) {
            throw new Error('User not found');
        }

        // Reset password
    // Tests expect hashSync usage
    user.password = bcrypt.hashSync(newPassword, 10);
        resetData.used = true;

        logger.info(`Password reset completed for user ${user.username}`);
        return true;
    }

    // Authentication logs
    getAuthLogs(limit = 100) {
        // In production, this would come from a database
        return Array.from(this.authAttempts.entries())
            .slice(-limit)
            .map(([key, data]) => ({
                identifier: key,
                attempts: data.count,
                lastAttempt: data.lastAttempt
            }));
    }

    // Cleanup expired tokens and sessions
    cleanup() {
        const now = new Date();

        // Clean expired refresh tokens
        for (const [token, data] of this.refreshTokens.entries()) {
            if (data.expiresAt < now) {
                this.refreshTokens.delete(token);
            }
        }

        // Clean old sessions (inactive for more than 24 hours)
        const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        for (const [sessionId, session] of this.sessions.entries()) {
            if (session.lastActivity < dayAgo) {
                this.sessions.delete(sessionId);
            }
        }

        logger.debug('Authentication cleanup completed');
    }

    // Start cleanup interval
    startCleanupInterval() {
        this.additionalCleanupInterval = setInterval(() => {
            this.cleanup();
        }, 60 * 60 * 1000); // Every hour
    }

    /**
     * Additional User Management & Utility Methods (restored for test compatibility)
     */
    createUser({ username, password, email, role = 'user' }) {
        if (this.users.has(username)) {
            throw new Error('Username already exists');
        }
        const id = this.users.size ? Math.max(...Array.from(this.users.values()).map(u => u.id)) + 1 : 1;
        const passwordHash = bcrypt.hashSync(password, 10);
        const user = {
            id,
            username,
            password: passwordHash,
            email,
            role,
            twoFactorEnabled: false,
            locked: false,
            failedAttempts: 0,
            lastLogin: null,
            createdAt: new Date()
        };
        this.users.set(username, user);
        logger.info(`User created: ${username}`);
        return user;
    }

    getUserById(id) {
        return Array.from(this.users.values()).find(u => u.id === id) || null;
    }

    deleteUser(id) {
        for (const [username, user] of this.users.entries()) {
            if (user.id === id) {
                this.users.delete(username);
                logger.info(`User deleted: ${username}`);
                return true;
            }
        }
        return false;
    }

    // Simple strength wrapper expected by tests
    validatePasswordStrength(password) {
        return this.validatePasswordComplexity(password).valid;
    }

    // Two-Factor helpers expected by tests
    async enableTwoFactor(userId, appName = 'Posterrama App') {
        // Generate secret
        const secret = speakeasy.generateSecret({
            name: appName,
            length: 32
        });
        this.twoFactorSecrets.set(userId, { secret: secret.base32, enabled: true, backupCodes: this.generateBackupCodes() });
        const qrCodeUrl = await this.generateQRCode(secret.otpauth_url || secret.base32).catch(() => null);
        return { secret: secret.base32, qrCodeUrl };
    }

    disableTwoFactor(userId) {
        const existed = this.twoFactorSecrets.delete(userId);
        return existed;
    }
}

// Create singleton instance
const authManager = new AuthenticationManager();
authManager.startCleanupInterval();

module.exports = authManager;
