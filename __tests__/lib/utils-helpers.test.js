/**
 * Tests for lib/utils-helpers.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const {
    sseDbg,
    getLocalIPAddress,
    getAvatarPath,
    isDeviceMgmtEnabled,
} = require('../../lib/utils-helpers');

describe('Utils Helpers', () => {
    describe('sseDbg', () => {
        const originalEnv = process.env.DEBUG_DEVICE_SSE;

        afterEach(() => {
            // Restore original env
            if (originalEnv) {
                process.env.DEBUG_DEVICE_SSE = originalEnv;
            } else {
                delete process.env.DEBUG_DEVICE_SSE;
            }
        });

        test('does nothing when DEBUG_DEVICE_SSE is not set', () => {
            delete process.env.DEBUG_DEVICE_SSE;
            // Should not throw
            expect(() => sseDbg('test message')).not.toThrow();
        });

        test('does nothing when DEBUG_DEVICE_SSE is false', () => {
            process.env.DEBUG_DEVICE_SSE = 'false';
            expect(() => sseDbg('test message')).not.toThrow();
        });

        test('logs when DEBUG_DEVICE_SSE is true', () => {
            process.env.DEBUG_DEVICE_SSE = 'true';
            // Should not throw
            expect(() => sseDbg('test message', { data: 'value' })).not.toThrow();
        });

        test('handles multiple arguments', () => {
            process.env.DEBUG_DEVICE_SSE = 'true';
            expect(() => sseDbg('arg1', 'arg2', 'arg3')).not.toThrow();
        });

        test('handles errors gracefully', () => {
            process.env.DEBUG_DEVICE_SSE = 'true';
            expect(() => sseDbg(undefined, null, { circular: null })).not.toThrow();
        });
    });

    describe('getLocalIPAddress', () => {
        test('returns a string', () => {
            const ip = getLocalIPAddress();
            expect(typeof ip).toBe('string');
        });

        test('returns localhost or valid IP', () => {
            const ip = getLocalIPAddress();
            // Should be either localhost or a valid IPv4 address
            expect(ip === 'localhost' || /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)).toBe(
                true
            );
        });

        test('does not return 127.0.0.1', () => {
            const ip = getLocalIPAddress();
            // Should return localhost string, not 127.0.0.1
            if (ip !== 'localhost') {
                expect(ip).not.toBe('127.0.0.1');
            }
        });

        test('returns consistent value on multiple calls', () => {
            const ip1 = getLocalIPAddress();
            const ip2 = getLocalIPAddress();
            expect(ip1).toBe(ip2);
        });
    });

    describe('getAvatarPath', () => {
        let testDir;

        beforeEach(() => {
            testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avatar-test-'));
        });

        afterEach(() => {
            try {
                fs.rmSync(testDir, { recursive: true, force: true });
            } catch (err) {
                // Ignore cleanup errors
            }
        });

        test('returns null when no avatar file exists', () => {
            const result = getAvatarPath('testuser', testDir);
            expect(result).toBeNull();
        });

        test('finds .png avatar', () => {
            const avatarPath = path.join(testDir, 'testuser.png');
            fs.writeFileSync(avatarPath, 'fake-image-data');

            const result = getAvatarPath('testuser', testDir);
            expect(result).toBe(avatarPath);
        });

        test('finds .webp avatar', () => {
            const avatarPath = path.join(testDir, 'testuser.webp');
            fs.writeFileSync(avatarPath, 'fake-image-data');

            const result = getAvatarPath('testuser', testDir);
            expect(result).toBe(avatarPath);
        });

        test('finds .jpg avatar', () => {
            const avatarPath = path.join(testDir, 'testuser.jpg');
            fs.writeFileSync(avatarPath, 'fake-image-data');

            const result = getAvatarPath('testuser', testDir);
            expect(result).toBe(avatarPath);
        });

        test('finds .jpeg avatar', () => {
            const avatarPath = path.join(testDir, 'testuser.jpeg');
            fs.writeFileSync(avatarPath, 'fake-image-data');

            const result = getAvatarPath('testuser', testDir);
            expect(result).toBe(avatarPath);
        });

        test('prefers .png over other formats', () => {
            fs.writeFileSync(path.join(testDir, 'testuser.png'), 'png-data');
            fs.writeFileSync(path.join(testDir, 'testuser.jpg'), 'jpg-data');

            const result = getAvatarPath('testuser', testDir);
            expect(result).toBe(path.join(testDir, 'testuser.png'));
        });

        test('sanitizes username with special characters', () => {
            // test@user! becomes test_user_ (@ and ! replaced with _)
            const avatarPath = path.join(testDir, 'test_user_.png');
            fs.writeFileSync(avatarPath, 'fake-image-data');

            const result = getAvatarPath('test@user!', testDir);
            expect(result).toBe(avatarPath);
        });

        test('defaults to admin when username is null', () => {
            const avatarPath = path.join(testDir, 'admin.png');
            fs.writeFileSync(avatarPath, 'fake-image-data');

            const result = getAvatarPath(null, testDir);
            expect(result).toBe(avatarPath);
        });

        test('defaults to admin when username is undefined', () => {
            const avatarPath = path.join(testDir, 'admin.png');
            fs.writeFileSync(avatarPath, 'fake-image-data');

            const result = getAvatarPath(undefined, testDir);
            expect(result).toBe(avatarPath);
        });

        test('handles empty string username', () => {
            const avatarPath = path.join(testDir, 'admin.png');
            fs.writeFileSync(avatarPath, 'fake-image-data');

            const result = getAvatarPath('', testDir);
            expect(result).toBe(avatarPath);
        });
    });

    describe('isDeviceMgmtEnabled', () => {
        let testDir;
        const originalEnv = process.env.DEVICE_MGMT_ENABLED;

        beforeEach(() => {
            testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
            delete process.env.DEVICE_MGMT_ENABLED;
        });

        afterEach(() => {
            // Restore original env
            if (originalEnv) {
                process.env.DEVICE_MGMT_ENABLED = originalEnv;
            } else {
                delete process.env.DEVICE_MGMT_ENABLED;
            }

            try {
                fs.rmSync(testDir, { recursive: true, force: true });
            } catch (err) {
                // Ignore cleanup errors
            }
        });

        test('returns false when config file does not exist', () => {
            const result = isDeviceMgmtEnabled(testDir);
            expect(result).toBe(false);
        });

        test('returns false when config has no deviceMgmt section', () => {
            const configPath = path.join(testDir, 'config.json');
            fs.writeFileSync(configPath, JSON.stringify({}));

            const result = isDeviceMgmtEnabled(testDir);
            expect(result).toBe(false);
        });

        test('returns false when deviceMgmt.enabled is false', () => {
            const configPath = path.join(testDir, 'config.json');
            fs.writeFileSync(configPath, JSON.stringify({ deviceMgmt: { enabled: false } }));

            const result = isDeviceMgmtEnabled(testDir);
            expect(result).toBe(false);
        });

        test('returns true when deviceMgmt.enabled is true in config', () => {
            const configPath = path.join(testDir, 'config.json');
            fs.writeFileSync(configPath, JSON.stringify({ deviceMgmt: { enabled: true } }));

            const result = isDeviceMgmtEnabled(testDir);
            expect(result).toBe(true);
        });

        test('returns true when DEVICE_MGMT_ENABLED env is "1"', () => {
            process.env.DEVICE_MGMT_ENABLED = '1';

            const result = isDeviceMgmtEnabled(testDir);
            expect(result).toBe(true);
        });

        test('returns true when DEVICE_MGMT_ENABLED env is "true"', () => {
            process.env.DEVICE_MGMT_ENABLED = 'true';

            const result = isDeviceMgmtEnabled(testDir);
            expect(result).toBe(true);
        });

        test('returns false when DEVICE_MGMT_ENABLED env is "false"', () => {
            process.env.DEVICE_MGMT_ENABLED = 'false';

            const result = isDeviceMgmtEnabled(testDir);
            expect(result).toBe(false);
        });

        test('prefers config.json over env when config is true', () => {
            process.env.DEVICE_MGMT_ENABLED = 'false';

            const configPath = path.join(testDir, 'config.json');
            fs.writeFileSync(configPath, JSON.stringify({ deviceMgmt: { enabled: true } }));

            const result = isDeviceMgmtEnabled(testDir);
            expect(result).toBe(true);
        });

        test('handles invalid JSON in config file', () => {
            const configPath = path.join(testDir, 'config.json');
            fs.writeFileSync(configPath, 'invalid json');

            const result = isDeviceMgmtEnabled(testDir);
            expect(result).toBe(false);
        });
    });
});
