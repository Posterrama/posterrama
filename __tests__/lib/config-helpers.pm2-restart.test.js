describe('restartPM2ForEnvUpdate (no execSync)', () => {
    const ORIGINAL_PM2_HOME = process.env.PM2_HOME;

    afterEach(() => {
        if (ORIGINAL_PM2_HOME === undefined) delete process.env.PM2_HOME;
        else process.env.PM2_HOME = ORIGINAL_PM2_HOME;

        jest.resetModules();
        jest.clearAllMocks();
        jest.unmock('child_process');
    });

    test('async=true uses child_process.exec and returns immediately', () => {
        process.env.PM2_HOME = '/tmp/pm2';

        jest.doMock('child_process', () => ({
            exec: jest.fn((_cmd, cb) => cb(null)),
            execSync: jest.fn(),
        }));

        jest.isolateModules(() => {
            const cp = require('child_process');
            const { restartPM2ForEnvUpdate } = require('../../lib/config-helpers');

            const result = restartPM2ForEnvUpdate('test', true);

            expect(result).toBeUndefined();
            expect(cp.exec).toHaveBeenCalledTimes(1);
            expect(cp.execSync).not.toHaveBeenCalled();
        });
    });

    test('async=false returns a Promise and does not call execSync', async () => {
        process.env.PM2_HOME = '/tmp/pm2';

        jest.doMock('child_process', () => ({
            exec: jest.fn((_cmd, cb) => cb(null)),
            execSync: jest.fn(),
        }));

        await jest.isolateModulesAsync(async () => {
            const cp = require('child_process');
            const { restartPM2ForEnvUpdate } = require('../../lib/config-helpers');

            const promise = restartPM2ForEnvUpdate('test', false);
            expect(promise).toBeInstanceOf(Promise);
            await promise;

            expect(cp.exec).toHaveBeenCalledTimes(1);
            expect(cp.execSync).not.toHaveBeenCalled();
        });
    });

    test('skips restart when not under PM2', () => {
        delete process.env.PM2_HOME;

        jest.doMock('child_process', () => ({
            exec: jest.fn(),
            execSync: jest.fn(),
        }));

        jest.isolateModules(() => {
            const cp = require('child_process');
            const { restartPM2ForEnvUpdate } = require('../../lib/config-helpers');

            const result = restartPM2ForEnvUpdate('test', false);
            expect(result).toBeUndefined();
            expect(cp.exec).not.toHaveBeenCalled();
            expect(cp.execSync).not.toHaveBeenCalled();
        });
    });
});
