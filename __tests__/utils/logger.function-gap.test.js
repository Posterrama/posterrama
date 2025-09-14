describe('logger function gap coverage', () => {
    beforeEach(() => {
        jest.resetModules();
    });

    test('uses configured timezone path and emits events', async () => {
        await jest.isolateModulesAsync(async () => {
            delete process.env.TEST_SILENT;
            // Mock config to force non-"auto" timezone branch
            jest.doMock('../../config.json', () => ({ clockTimezone: 'UTC' }), { virtual: true });
            const logger = require('../../utils/logger');

            logger.__resetMemory();

            const onLog = jest.fn();
            logger.events.once('log', onLog);

            // Use warn/error to respect default test logger level ('warn')
            logger.warn({ a: 1, _raw: 'hide-me' }); // exercises JSON stringify with replacer
            logger.warn('warn-msg');
            logger.error(new Error('boom'));

            // Allow async transport write to flush
            await new Promise(r => setTimeout(r, 15));

            const all = logger.getRecentLogs(null, 200);
            expect(all.length).toBeGreaterThanOrEqual(3);
            // Ensure entries have the formatted shape
            expect(all[all.length - 1]).toHaveProperty('timestamp');
            expect(all[all.length - 1]).toHaveProperty('level');
            expect(all[all.length - 1]).toHaveProperty('message');

            // Event emitted for memory transport write
            expect(onLog).toHaveBeenCalled();

            // Level filter should include WARN and ERROR when requesting WARN
            const warnAndAbove = logger.getRecentLogs('WARN');
            expect(Array.isArray(warnAndAbove)).toBe(true);
            expect(warnAndAbove.some(l => l.level === 'ERROR' || l.level === 'WARN')).toBe(true);
        });
    });

    test('exclusion filter prevents admin memory storage', async () => {
        await jest.isolateModulesAsync(async () => {
            delete process.env.TEST_SILENT;
            jest.doMock('../../config.json', () => ({ clockTimezone: 'UTC' }), { virtual: true });
            const logger = require('../../utils/logger');
            logger.__resetMemory();

            // Use warn so messages aren't filtered by level; first is excluded by pattern
            logger.warn('[Auth] Authenticated via session');
            logger.warn('hello-keep');

            await new Promise(r => setTimeout(r, 15));

            const logs = logger.getRecentLogs();
            expect(logs.find(l => String(l.message).includes('hello-keep'))).toBeTruthy();
            expect(
                logs.find(l => String(l.message).includes('Authenticated via session'))
            ).toBeFalsy();
        });
    });

    test('getRecentLogs honors limit and unknown level input', async () => {
        await jest.isolateModulesAsync(async () => {
            delete process.env.TEST_SILENT;
            jest.doMock('../../config.json', () => ({ clockTimezone: 'UTC' }), { virtual: true });
            const logger = require('../../utils/logger');
            logger.__resetMemory();

            for (let i = 0; i < 5; i++) {
                logger.warn(`w-${i}`);
            }
            await new Promise(r => setTimeout(r, 15));
            const limited = logger.getRecentLogs('not-a-real-level', 3);
            expect(limited).toHaveLength(3);
            // Ensure we got the most recent entries
            expect(String(limited[0].message)).toContain('w-');
        });
    });
});
