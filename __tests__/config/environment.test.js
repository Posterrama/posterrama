/**
 * @file __tests__/config/environment.test.js
 * Comprehensive tests for centralized environment configuration
 */

describe('Environment Configuration Module', () => {
    let originalEnv;

    beforeEach(() => {
        // Save original process.env
        originalEnv = { ...process.env };

        // Clear module cache to get fresh env module
        jest.resetModules();
    });

    afterEach(() => {
        // Restore original process.env
        process.env = originalEnv;
    });

    describe('Helper Functions', () => {
        test('getBoolean() should parse boolean values correctly', () => {
            process.env.TEST_BOOL_TRUE = 'true';
            process.env.TEST_BOOL_ONE = '1';
            process.env.TEST_BOOL_FALSE = 'false';
            process.env.TEST_BOOL_EMPTY = '';

            const env = require('../../config/environment');

            expect(env.getBoolean('TEST_BOOL_TRUE')).toBe(true);
            expect(env.getBoolean('TEST_BOOL_ONE')).toBe(true);
            expect(env.getBoolean('TEST_BOOL_FALSE')).toBe(false);
            expect(env.getBoolean('TEST_BOOL_EMPTY')).toBe(false);
            expect(env.getBoolean('TEST_BOOL_MISSING')).toBe(false);
            expect(env.getBoolean('TEST_BOOL_MISSING', true)).toBe(true);
        });

        test('getNumber() should parse number values correctly', () => {
            process.env.TEST_NUM_VALID = '42';
            process.env.TEST_NUM_FLOAT = '3.14';
            process.env.TEST_NUM_INVALID = 'not-a-number';
            process.env.TEST_NUM_EMPTY = '';

            const env = require('../../config/environment');

            expect(env.getNumber('TEST_NUM_VALID')).toBe(42);
            expect(env.getNumber('TEST_NUM_FLOAT')).toBe(3.14);
            expect(env.getNumber('TEST_NUM_INVALID')).toBe(0);
            expect(env.getNumber('TEST_NUM_EMPTY')).toBe(0);
            expect(env.getNumber('TEST_NUM_MISSING')).toBe(0);
            expect(env.getNumber('TEST_NUM_MISSING', 100)).toBe(100);
        });

        test('getString() should return string values or defaults', () => {
            process.env.TEST_STR_VALUE = 'hello';
            process.env.TEST_STR_EMPTY = '';

            const env = require('../../config/environment');

            expect(env.getString('TEST_STR_VALUE')).toBe('hello');
            expect(env.getString('TEST_STR_EMPTY')).toBe('');
            expect(env.getString('TEST_STR_MISSING')).toBe('');
            expect(env.getString('TEST_STR_MISSING', 'default')).toBe('default');
        });

        test('getTrimmed() should trim whitespace from values', () => {
            process.env.TEST_TRIM_VALUE = '  hello  ';
            process.env.TEST_TRIM_EMPTY = '   ';

            const env = require('../../config/environment');

            expect(env.getTrimmed('TEST_TRIM_VALUE')).toBe('hello');
            expect(env.getTrimmed('TEST_TRIM_EMPTY')).toBe('');
            expect(env.getTrimmed('TEST_TRIM_MISSING')).toBe('');
            expect(env.getTrimmed('TEST_TRIM_MISSING', 'default')).toBe('default');
        });

        test('isSet() should check if variable is set and non-empty', () => {
            process.env.TEST_SET_VALUE = 'something';
            process.env.TEST_SET_EMPTY = '';
            process.env.TEST_SET_SPACES = '   ';

            const env = require('../../config/environment');

            expect(env.isSet('TEST_SET_VALUE')).toBe(true);
            expect(env.isSet('TEST_SET_EMPTY')).toBe(false);
            expect(env.isSet('TEST_SET_SPACES')).toBe(false);
            expect(env.isSet('TEST_SET_MISSING')).toBe(false);
        });
    });

    describe('Server Configuration', () => {
        test('should use defaults for server configuration', () => {
            delete process.env.SERVER_PORT;
            delete process.env.NODE_ENV;
            delete process.env.DEBUG;

            const env = require('../../config/environment');

            expect(env.server.port).toBe(4000);
            expect(env.server.nodeEnv).toBe('development');
            expect(env.server.debug).toBe(false);
            expect(env.server.slowRequestMs).toBe(3000);
            expect(env.server.exposeInternalEndpoints).toBe(false);
        });

        test('should parse server configuration from environment', () => {
            process.env.SERVER_PORT = '8080';
            process.env.NODE_ENV = 'production';
            process.env.DEBUG = 'true';
            process.env.SLOW_REQUEST_WARN_MS = '5000';
            process.env.EXPOSE_INTERNAL_ENDPOINTS = 'true';

            const env = require('../../config/environment');

            expect(env.server.port).toBe(8080);
            expect(env.server.nodeEnv).toBe('production');
            expect(env.server.debug).toBe(true);
            expect(env.server.slowRequestMs).toBe(5000);
            expect(env.server.exposeInternalEndpoints).toBe(true);
        });
    });

    describe('Authentication Configuration', () => {
        test('should parse authentication configuration', () => {
            process.env.ADMIN_USERNAME = 'admin';
            process.env.ADMIN_PASSWORD_HASH = '$2b$10$hash';
            process.env.ADMIN_2FA_SECRET = 'SECRET123';
            process.env.API_ACCESS_TOKEN = 'token123';
            process.env.SESSION_SECRET = 'session-secret';

            const env = require('../../config/environment');

            expect(env.auth.adminUsername).toBe('admin');
            expect(env.auth.adminPasswordHash).toBe('$2b$10$hash');
            expect(env.auth.admin2FASecret).toBe('SECRET123');
            expect(env.auth.apiAccessToken).toBe('token123');
            expect(env.auth.sessionSecret).toBe('session-secret');
        });

        test('auth.hasAdminCredentials() should check credentials', () => {
            process.env.ADMIN_USERNAME = 'admin';
            process.env.ADMIN_PASSWORD_HASH = 'hash';

            const env = require('../../config/environment');

            expect(env.auth.hasAdminCredentials()).toBe(true);

            delete process.env.ADMIN_USERNAME;
            jest.resetModules();
            const env2 = require('../../config/environment');
            expect(env2.auth.hasAdminCredentials()).toBe(false);
        });

        test('auth.has2FA() should check 2FA status', () => {
            process.env.ADMIN_2FA_SECRET = 'SECRET';

            const env = require('../../config/environment');

            expect(env.auth.has2FA()).toBe(true);

            delete process.env.ADMIN_2FA_SECRET;
            jest.resetModules();
            const env2 = require('../../config/environment');
            expect(env2.auth.has2FA()).toBe(false);
        });

        test('auth.hasApiToken() should check API token status', () => {
            process.env.API_ACCESS_TOKEN = 'token';

            const env = require('../../config/environment');

            expect(env.auth.hasApiToken()).toBe(true);

            delete process.env.API_ACCESS_TOKEN;
            jest.resetModules();
            const env2 = require('../../config/environment');
            expect(env2.auth.hasApiToken()).toBe(false);
        });

        test('should trim whitespace from secrets', () => {
            process.env.ADMIN_USERNAME = '  admin  ';
            process.env.ADMIN_2FA_SECRET = '  SECRET  ';

            const env = require('../../config/environment');

            expect(env.auth.adminUsername).toBe('admin');
            expect(env.auth.admin2FASecret).toBe('SECRET');
        });
    });

    describe('Plex Configuration', () => {
        test('should parse Plex configuration', () => {
            process.env.PLEX_HOSTNAME = 'plex.example.com';
            process.env.PLEX_PORT = '32400';
            process.env.PLEX_TOKEN = 'plex-token';
            process.env.PLEX_PREVIEW_PAGE_SIZE = '500';

            const env = require('../../config/environment');

            expect(env.plex.hostname).toBe('plex.example.com');
            expect(env.plex.port).toBe(32400);
            expect(env.plex.token).toBe('plex-token');
            expect(env.plex.previewPageSize).toBe(500);
        });

        test('should use Plex defaults', () => {
            delete process.env.PLEX_PORT;
            delete process.env.PLEX_PREVIEW_PAGE_SIZE;

            const env = require('../../config/environment');

            expect(env.plex.port).toBe(32400);
            expect(env.plex.previewPageSize).toBe(200);
        });
    });

    describe('Jellyfin Configuration', () => {
        test('should parse Jellyfin configuration', () => {
            process.env.JELLYFIN_HOSTNAME = 'jellyfin.example.com';
            process.env.JELLYFIN_PORT = '8096';
            process.env.JELLYFIN_TOKEN = 'jf-token';
            process.env.JELLYFIN_INSECURE_HTTPS = 'true';
            process.env.JF_PREVIEW_PAGE_SIZE = '2000';

            const env = require('../../config/environment');

            expect(env.jellyfin.hostname).toBe('jellyfin.example.com');
            expect(env.jellyfin.port).toBe(8096);
            expect(env.jellyfin.token).toBe('jf-token');
            expect(env.jellyfin.insecureHttps).toBe(true);
            expect(env.jellyfin.previewPageSize).toBe(2000);
        });

        test('should use Jellyfin defaults', () => {
            delete process.env.JELLYFIN_PORT;
            delete process.env.JELLYFIN_INSECURE_HTTPS;
            delete process.env.JF_PREVIEW_PAGE_SIZE;

            const env = require('../../config/environment');

            expect(env.jellyfin.port).toBe(8096);
            expect(env.jellyfin.insecureHttps).toBe(false);
            expect(env.jellyfin.previewPageSize).toBe(1000);
        });
    });

    describe('Logging Configuration', () => {
        test('should parse logging configuration', () => {
            process.env.LOG_LEVEL = 'warn';
            process.env.API_REQUEST_LOG_LEVEL = 'info';
            process.env.API_REQUEST_LOG_SAMPLE = '0.5';
            process.env.TEST_SILENT = 'true';
            process.env.PRINT_AUTH_DEBUG = 'true';
            process.env.DEBUG_DEVICE_SSE = 'true';

            const env = require('../../config/environment');

            expect(env.logging.logLevel).toBe('warn');
            expect(env.logging.apiRequestLogLevel).toBe('info');
            expect(env.logging.apiRequestLogSample).toBe(0.5);
            expect(env.logging.testSilent).toBe(true);
            expect(env.logging.printAuthDebug).toBe(true);
            expect(env.logging.debugDeviceSSE).toBe(true);
        });

        test('should use logging defaults', () => {
            delete process.env.LOG_LEVEL;
            delete process.env.API_REQUEST_LOG_LEVEL;

            const env = require('../../config/environment');

            expect(env.logging.logLevel).toBe('info');
            expect(env.logging.apiRequestLogLevel).toBe('debug');
            expect(env.logging.apiRequestLogSample).toBe(0);
        });
    });

    describe('Features Configuration', () => {
        test('should parse feature flags', () => {
            process.env.DEVICE_MGMT_ENABLED = 'true';
            process.env.DEVICES_STORE_PATH = 'custom-devices.json';

            const env = require('../../config/environment');

            expect(env.features.deviceManagement).toBe(true);
            expect(env.features.devicesStorePath).toBe('custom-devices.json');
        });

        test('should use feature defaults', () => {
            delete process.env.DEVICE_MGMT_ENABLED;
            delete process.env.DEVICES_STORE_PATH;

            const env = require('../../config/environment');

            expect(env.features.deviceManagement).toBe(false);
            expect(env.features.devicesStorePath).toBe('devices.json');
        });
    });

    describe('Performance Configuration', () => {
        test('should parse performance settings', () => {
            process.env.ADMIN_FILTER_PREVIEW_TIMEOUT_MS = '10000';
            process.env.STARTUP_FETCH_TIMEOUT_MS = '15000';

            const env = require('../../config/environment');

            expect(env.performance.adminFilterPreviewTimeoutMs).toBe(10000);
            expect(env.performance.startupFetchTimeoutMs).toBe(15000);
        });

        test('should use performance defaults', () => {
            delete process.env.ADMIN_FILTER_PREVIEW_TIMEOUT_MS;
            delete process.env.STARTUP_FETCH_TIMEOUT_MS;

            const env = require('../../config/environment');

            expect(env.performance.adminFilterPreviewTimeoutMs).toBe(8000);
            expect(env.performance.startupFetchTimeoutMs).toBe(12000);
        });
    });

    describe('PM2 Configuration', () => {
        test('should detect PM2 environment', () => {
            process.env.PM2_HOME = '/home/user/.pm2';

            const env = require('../../config/environment');

            expect(env.pm2.home).toBe('/home/user/.pm2');
            expect(env.pm2.isEnabled()).toBe(true);
        });

        test('should detect non-PM2 environment', () => {
            delete process.env.PM2_HOME;

            const env = require('../../config/environment');

            expect(env.pm2.home).toBe('');
            expect(env.pm2.isEnabled()).toBe(false);
        });
    });

    describe('Validation', () => {
        test('should not throw error when SESSION_SECRET is set', () => {
            process.env.SESSION_SECRET = 'test-secret';
            process.env.NODE_ENV = 'development';

            expect(() => {
                jest.resetModules();
                require('../../config/environment');
            }).not.toThrow();
        });

        test('validate() should throw error when SESSION_SECRET is missing', () => {
            delete process.env.SESSION_SECRET;

            const env = require('../../config/environment');

            expect(() => {
                env.validate();
            }).toThrow(/SESSION_SECRET is required/);
        });

        test('validate() should throw error when 2FA without admin credentials', () => {
            process.env.SESSION_SECRET = 'secret';
            process.env.ADMIN_2FA_SECRET = 'totp-secret';
            delete process.env.ADMIN_USERNAME;
            delete process.env.ADMIN_PASSWORD_HASH;

            const env = require('../../config/environment');

            expect(() => {
                env.validate();
            }).toThrow(/ADMIN_2FA_SECRET requires ADMIN_USERNAME and ADMIN_PASSWORD_HASH/);
        });
    });

    describe('getSummary()', () => {
        test('should return environment summary without secrets', () => {
            process.env.SERVER_PORT = '4000';
            process.env.NODE_ENV = 'production';
            process.env.ADMIN_USERNAME = 'admin';
            process.env.ADMIN_PASSWORD_HASH = 'secret-hash';
            process.env.ADMIN_2FA_SECRET = 'totp-secret';
            process.env.API_ACCESS_TOKEN = 'api-token';
            process.env.PLEX_HOSTNAME = 'plex.local';
            process.env.PLEX_TOKEN = 'plex-token';
            process.env.DEVICE_MGMT_ENABLED = 'true';
            process.env.PM2_HOME = '/pm2';

            const env = require('../../config/environment');
            const summary = env.getSummary();

            // Check structure
            expect(summary).toHaveProperty('server');
            expect(summary).toHaveProperty('auth');
            expect(summary).toHaveProperty('plex');
            expect(summary).toHaveProperty('jellyfin');
            expect(summary).toHaveProperty('features');
            expect(summary).toHaveProperty('pm2');

            // Check values (no secrets)
            expect(summary.server.port).toBe(4000);
            expect(summary.server.nodeEnv).toBe('production');
            expect(summary.auth.hasAdminCredentials).toBe(true);
            expect(summary.auth.has2FA).toBe(true);
            expect(summary.auth.hasApiToken).toBe(true);
            expect(summary.plex.configured).toBe(true);
            expect(summary.plex.hostname).toBe('plex.local');
            expect(summary.features.deviceManagement).toBe(true);
            expect(summary.pm2.enabled).toBe(true);

            // Ensure secrets are NOT in summary
            expect(JSON.stringify(summary)).not.toContain('secret-hash');
            expect(JSON.stringify(summary)).not.toContain('totp-secret');
            expect(JSON.stringify(summary)).not.toContain('api-token');
            expect(JSON.stringify(summary)).not.toContain('plex-token');
        });
    });

    describe('Invalid Number Parsing', () => {
        test('should warn and use default for invalid numbers', () => {
            process.env.SERVER_PORT = 'not-a-number';

            // Spy on logger to verify warning
            const logger = require('../../utils/logger');
            const warnSpy = jest.spyOn(logger, 'warn').mockImplementation();

            const env = require('../../config/environment');

            expect(env.server.port).toBe(4000); // Default value
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('[Environment] Invalid number for SERVER_PORT')
            );

            warnSpy.mockRestore();
        });
    });
});
