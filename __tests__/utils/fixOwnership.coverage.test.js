const path = require('path');

// Mock logger early
// Defer requiring logger until after potential module resets
jest.mock('../../utils/logger', () => {
    return {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    };
});
const logger = require('../../utils/logger');

// We'll monkey patch fs and child_process for deterministic behavior
const realFs = require('fs');
const realChild = require('child_process');

describe('fixOwnership coverage', () => {
    let fixOwnership; // will require after mocks adjusted per test (env dependent logic uses process.env at runtime)

    const ORIGINAL_ENV = { ...process.env };
    const originalGetuid = process.getuid;
    const originalGetgid = process.getgid;
    const originalSetuid = process.setuid;
    const originalSetgid = process.setgid;

    // Mutable mock state
    let mockFsState;

    function resetFsMocks() {
        mockFsState = {};
    }

    function addFile(p, { uid = 0, gid = 0, type = 'file' } = {}) {
        mockFsState[p] = { uid, gid, type };
    }

    function installFsMocks() {
        jest.spyOn(realFs, 'existsSync').mockImplementation(p => !!mockFsState[p]);
        jest.spyOn(realFs, 'statSync').mockImplementation(p => {
            if (!mockFsState[p]) throw new Error('ENOENT');
            return mockFsState[p];
        });
        jest.spyOn(realFs, 'chownSync').mockImplementation((p, uid, gid) => {
            if (!mockFsState[p]) throw new Error('ENOENT');
            mockFsState[p].uid = uid;
            mockFsState[p].gid = gid;
        });
        jest.spyOn(realFs, 'readdirSync').mockImplementation(dir => {
            return Object.keys(mockFsState)
                .filter(f => path.dirname(f) === dir)
                .map(f => path.basename(f));
        });
    }

    function mockChildProcess(execMap) {
        jest.spyOn(realChild, 'execSync').mockImplementation(cmd => {
            if (execMap[cmd]) return Buffer.from(String(execMap[cmd]));
            throw new Error('exec fail');
        });
    }

    function requireFresh() {
        jest.isolateModules(() => {
            fixOwnership = require('../../utils/fixOwnership').fixOwnership;
        });
    }

    beforeEach(() => {
        process.env = { ...ORIGINAL_ENV }; // reset env
        delete process.env.POSTERRAMA_AUTO_CHOWN;
        delete process.env.POSTERRAMA_RUN_AS_UID;
        delete process.env.POSTERRAMA_RUN_AS_GID;
        delete process.env.POSTERRAMA_RUN_AS_USER;
        delete process.env.POSTERRAMA_DROP_PRIVS;
        process.env.NODE_ENV = 'production'; // ensure not 'test'
        // root identity simulation
        process.getuid = () => 0;
        process.getgid = () => 0;
        process.setuid = jest.fn();
        process.setgid = jest.fn();
        jest.restoreAllMocks();
        resetFsMocks();
        logger.info.mockReset();
        logger.warn.mockReset();
        logger.error.mockReset();
    });

    afterAll(() => {
        process.env = ORIGINAL_ENV;
        process.getuid = originalGetuid;
        process.getgid = originalGetgid;
        process.setuid = originalSetuid;
        process.setgid = originalSetgid;
    });

    test('skips in test env', () => {
        process.env.NODE_ENV = 'test';
        requireFresh();
        const res = fixOwnership();
        expect(res.skipped).toBe(true);
        expect(res.reason).toMatch(/test env/);
    });

    test('skips when not root', () => {
        process.getuid = () => 1000;
        requireFresh();
        const res = fixOwnership();
        expect(res.skipped).toBe(true);
        expect(res.reason).toMatch(/not running as root/);
    });

    test('skips when AUTO_CHOWN not true', () => {
        requireFresh();
        const res = fixOwnership();
        expect(res.skipped).toBe(true);
        expect(res.reason).toMatch(/AUTO_CHOWN/);
    });

    test('skips when no uid/gid resolved', () => {
        process.env.POSTERRAMA_AUTO_CHOWN = 'true';
        requireFresh();
        const res = fixOwnership({ baseDir: '/tmp/base' });
        expect(res.skipped).toBe(true);
        expect(res.reason).toMatch(/no target uid\/gid/);
    });

    test('resolves numeric uid/gid and changes some files', () => {
        process.env.POSTERRAMA_AUTO_CHOWN = 'true';
        process.env.POSTERRAMA_RUN_AS_UID = '2000';
        process.env.POSTERRAMA_RUN_AS_GID = '3000';
        const baseDir = '/tmp/base';
        // Add target files; some already correct, some not, and one extra devices variant
        addFile(path.join(baseDir, 'config.json'), { uid: 0, gid: 0 }); // should change
        addFile(path.join(baseDir, 'groups.json'), { uid: 2000, gid: 3000 }); // unchanged
        addFile(path.join(baseDir, 'devices.json'), { uid: 0, gid: 0 }); // change
        addFile(path.join(baseDir, 'devices.pruned.json'), { uid: 0, gid: 3000 }); // uid change only
        addFile(path.join(baseDir, 'sessions'), { uid: 0, gid: 0 }); // change
        addFile(path.join(baseDir, 'cache'), { uid: 2000, gid: 3000 }); // unchanged
        addFile(path.join(baseDir, 'image_cache'), { uid: 0, gid: 3000 }); // uid change only
        addFile(path.join(baseDir, 'logs'), { uid: 0, gid: 0 }); // change
        installFsMocks();
        requireFresh();
        const res = fixOwnership({ baseDir });
        expect(res.uid).toBe(2000);
        expect(res.gid).toBe(3000);
        expect(res.changed.length).toBeGreaterThan(0);
        expect(res.unchanged.length).toBeGreaterThan(0);
        // logger.info called with message and summary object as two args; relax to any call containing substring
        expect(
            logger.info.mock.calls.find(c =>
                String(c[0]).includes('[Ownership] normalization summary')
            )
        ).toBeDefined();
    });

    test('resolves via username when numeric absent', () => {
        process.env.POSTERRAMA_AUTO_CHOWN = 'true';
        process.env.POSTERRAMA_RUN_AS_USER = 'posterrama';
        mockChildProcess({ 'id -u posterrama': 1500, 'id -g posterrama': 1600 });
        const baseDir = '/tmp/base2';
        addFile(path.join(baseDir, 'config.json'), { uid: 0, gid: 0 });
        installFsMocks();
        requireFresh();
        const res = fixOwnership({ baseDir });
        expect(res.uid).toBe(1500);
        expect(res.gid).toBe(1600);
        expect(logger.warn).not.toHaveBeenCalled();
    });

    test('username resolution failure warns and skips', () => {
        process.env.POSTERRAMA_AUTO_CHOWN = 'true';
        process.env.POSTERRAMA_RUN_AS_USER = 'missinguser';
        mockChildProcess({}); // will throw
        const baseDir = '/tmp/base3';
        addFile(path.join(baseDir, 'config.json'), { uid: 0, gid: 0 });
        installFsMocks();
        requireFresh();
        const res = fixOwnership({ baseDir });
        expect(res.skipped).toBe(true);
        expect(res.reason).toMatch(/no target/);
        // warn logged during resolution failure path
        expect(logger.warn.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    test('drop privileges path with success', () => {
        process.env.POSTERRAMA_AUTO_CHOWN = 'true';
        process.env.POSTERRAMA_RUN_AS_UID = '4000';
        process.env.POSTERRAMA_RUN_AS_GID = '5000';
        process.env.POSTERRAMA_DROP_PRIVS = 'true';
        const baseDir = '/tmp/base4';
        addFile(path.join(baseDir, 'config.json'), { uid: 0, gid: 0 });
        installFsMocks();
        requireFresh();
        const res = fixOwnership({ baseDir });
        expect(process.setgid).toHaveBeenCalledWith(5000);
        expect(process.setuid).toHaveBeenCalledWith(4000);
        expect(
            logger.info.mock.calls.find(c => String(c[0]).includes('Dropped privileges'))
        ).toBeDefined();
        expect(res.changed.length).toBe(1);
    });

    test('privilege drop failure logs error', () => {
        process.env.POSTERRAMA_AUTO_CHOWN = 'true';
        process.env.POSTERRAMA_RUN_AS_UID = '4000';
        process.env.POSTERRAMA_RUN_AS_GID = '5000';
        process.env.POSTERRAMA_DROP_PRIVS = 'true';
        process.setuid = jest.fn(() => {
            throw new Error('fail setuid');
        });
        const baseDir = '/tmp/base5';
        addFile(path.join(baseDir, 'config.json'), { uid: 0, gid: 0 });
        installFsMocks();
        requireFresh();
        const res = fixOwnership({ baseDir });
        expect(
            logger.error.mock.calls.find(c => String(c[0]).includes('Failed to drop privileges'))
        ).toBeDefined();
        expect(res.changed.length).toBe(1);
    });

    test('handles stat failure gracefully (failed array)', () => {
        process.env.POSTERRAMA_AUTO_CHOWN = 'true';
        process.env.POSTERRAMA_RUN_AS_UID = '6000';
        const baseDir = '/tmp/base6';
        // Add file then force statSync to throw for it after existsSync true
        addFile(path.join(baseDir, 'config.json'), { uid: 0, gid: 0 });
        jest.spyOn(realFs, 'existsSync').mockImplementation(_p => true);
        jest.spyOn(realFs, 'statSync').mockImplementation(() => {
            throw new Error('stat fail');
        });
        jest.spyOn(realFs, 'readdirSync').mockImplementation(() => ['config.json']);
        jest.spyOn(realFs, 'chownSync').mockImplementation(() => {});
        requireFresh();
        const res = fixOwnership({ baseDir });
        // All target paths fail stat -> multiple failures
        expect(res.failed.length).toBeGreaterThan(0);
    });
});
