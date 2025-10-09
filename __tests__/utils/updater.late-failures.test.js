/**
 * Intent: Cover late-stage failure branches in updater (dependencies, verify, deferStop restart)
 * Determinism: All network/fs/process operations mocked; no real side effects.
 * Targets:
 *  - updateDependencies throws after applyUpdate success -> rollback triggered
 *  - verifyUpdate throws at verification phase -> rollback triggered
 *  - deferStop path with startServices rejecting -> completion still marked success (error swallowed)
 */

// Fresh instance per test via cache reset
const path = require('path');

// Mock logger to silence output
jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
}));

// Minimal fs mock for writeStatus/version reads
jest.mock('fs', () => ({
    promises: {
        mkdir: jest.fn().mockResolvedValue(),
        writeFile: jest.fn().mockResolvedValue(),
        readFile: jest.fn(async p => {
            if (String(p).endsWith('package.json')) {
                return JSON.stringify({ version: '1.0.0' });
            }
            return '{}';
        }),
        access: jest.fn().mockResolvedValue(),
        stat: jest
            .fn()
            .mockResolvedValue({ size: 5000, isDirectory: () => false, birthtime: new Date() }),
        readdir: jest.fn().mockResolvedValue([]),
        copyFile: jest.fn().mockResolvedValue(),
        rename: jest.fn().mockResolvedValue(),
        unlink: jest.fn().mockResolvedValue(),
        rmdir: jest.fn().mockResolvedValue(),
    },
    createWriteStream: jest.fn(() => ({
        close: jest.fn(),
        on: jest.fn((ev, cb) => {
            if (ev === 'finish') cb();
        }),
        pipe: jest.fn(),
    })),
}));

// Mock https get for downloadUpdate path
jest.mock('https', () => ({
    get: (url, opts, cb) => {
        if (typeof opts === 'function') {
            cb = opts;
        }
        // Simulate 200 with pipe into file
        const res = {
            statusCode: 200,
            pipe: f => {
                setImmediate(() => {
                    f.on && f.on('finish', () => {});
                    if (f.close) f.close();
                });
            },
            on: jest.fn(),
        };
        cb && cb(res);
        return {
            on: jest.fn(),
            setTimeout: jest.fn(),
            destroy: jest.fn(),
        };
    },
}));

// AdmZip mock (validate + extract)
jest.mock('adm-zip', () => {
    return jest.fn().mockImplementation(() => ({
        getEntries: () => [{ entryName: 'package.json' }, { entryName: 'server.js' }],
        extractAllTo: jest.fn(),
    }));
});

describe('updater late-stage failures', () => {
    let updater;

    function freshUpdater() {
        jest.resetModules();
        delete require.cache[require.resolve('../../utils/updater')];
        updater = require('../../utils/updater');
    }

    beforeEach(() => {
        freshUpdater();
    });

    test('dependency installation failure triggers rollback', async () => {
        const spy = {
            check: jest
                .spyOn(updater, 'checkForUpdates')
                .mockResolvedValue({ hasUpdate: true, latestVersion: '1.1.0' }),
            createBackup: jest
                .spyOn(updater, 'createBackup')
                .mockResolvedValue(path.join(__dirname, 'bk')),
            download: jest.spyOn(updater, 'downloadUpdate').mockResolvedValue('/tmp/update.zip'),
            validate: jest.spyOn(updater, 'validateDownload').mockResolvedValue(),
            stop: jest.spyOn(updater, 'stopServices').mockResolvedValue(),
            apply: jest.spyOn(updater, 'applyUpdate').mockResolvedValue(),
            deps: jest
                .spyOn(updater, 'updateDependencies')
                .mockRejectedValue(new Error('npm failed')),
            rollback: jest.spyOn(updater, 'rollback').mockResolvedValue(),
        };

        await expect(updater.startUpdate()).rejects.toThrow('npm failed');
        expect(spy.rollback).toHaveBeenCalled();
        expect(updater.updateStatus.phase).toBe('error');
        expect(updater.updateStatus.message).toMatch(/Update failed/);
    });

    test('verification failure triggers rollback', async () => {
        const spy = {
            check: jest
                .spyOn(updater, 'checkForUpdates')
                .mockResolvedValue({ hasUpdate: true, latestVersion: '2.0.0' }),
            createBackup: jest
                .spyOn(updater, 'createBackup')
                .mockResolvedValue(path.join(__dirname, 'bk2')),
            download: jest.spyOn(updater, 'downloadUpdate').mockResolvedValue('/tmp/update2.zip'),
            validate: jest.spyOn(updater, 'validateDownload').mockResolvedValue(),
            stop: jest.spyOn(updater, 'stopServices').mockResolvedValue(),
            apply: jest.spyOn(updater, 'applyUpdate').mockResolvedValue(),
            deps: jest.spyOn(updater, 'updateDependencies').mockResolvedValue(),
            start: jest.spyOn(updater, 'startServices').mockResolvedValue(),
            verify: jest
                .spyOn(updater, 'verifyUpdate')
                .mockRejectedValue(new Error('version mismatch')),
            rollback: jest.spyOn(updater, 'rollback').mockResolvedValue(),
        };

        await expect(updater.startUpdate()).rejects.toThrow('version mismatch');
        expect(spy.rollback).toHaveBeenCalled();
        expect(updater.updateStatus.phase).toBe('error');
    });

    test('deferStop path swallows startServices failure and completes', async () => {
        const spy = {
            check: jest
                .spyOn(updater, 'checkForUpdates')
                .mockResolvedValue({ hasUpdate: true, latestVersion: '3.0.0' }),
            createBackup: jest
                .spyOn(updater, 'createBackup')
                .mockResolvedValue(path.join(__dirname, 'bk3')),
            download: jest.spyOn(updater, 'downloadUpdate').mockResolvedValue('/tmp/update3.zip'),
            validate: jest.spyOn(updater, 'validateDownload').mockResolvedValue(),
            stop: jest.spyOn(updater, 'stopServices').mockResolvedValue(),
            apply: jest.spyOn(updater, 'applyUpdate').mockResolvedValue(),
            deps: jest.spyOn(updater, 'updateDependencies').mockResolvedValue(),
            fix: jest.spyOn(updater, 'fixOwnership').mockResolvedValue(),
            cleanup: jest.spyOn(updater, 'cleanup').mockResolvedValue(),
            start: jest
                .spyOn(updater, 'startServices')
                .mockRejectedValue(new Error('pm2 restart failed')),
        };

        const result = await updater.startUpdate(null, { deferStop: true });
        expect(result.success).toBe(true);
        expect(updater.updateStatus.phase).toBe('completed');
        expect(spy.start).toHaveBeenCalled();
        // Ensure failure did not abort pipeline
        expect(updater.updateInProgress).toBe(false);
    });
});
